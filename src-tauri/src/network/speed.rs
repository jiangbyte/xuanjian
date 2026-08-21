//! å¤šè¿žæŽ¥å¹¶è¡Œç½‘ç»œæµ‹é€Ÿï¼šå»¶è¿Ÿ + ä¸‹è½½ + ä¸Šä¼ ã€‚
//!
//! Author: Charlie

use crate::network::NetworkState;
use bytes::Bytes;
use futures::stream::{self, StreamExt};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

const MIN_CONCURRENCY: u32 = 1;
const MAX_CONCURRENCY: u32 = 8;
const DEFAULT_DOWNLOAD_BYTES: u64 = 50 * 1024 * 1024;
const DEFAULT_UPLOAD_BYTES: u64 = 20 * 1024 * 1024;
const MAX_BYTES: u64 = 200 * 1024 * 1024;
const MIN_BYTES: u64 = 1024 * 1024;
const DEFAULT_ROUNDS: u32 = 3;
const MIN_ROUNDS: u32 = 1;
const MAX_ROUNDS: u32 = 5;
const PROGRESS_INTERVAL_MS: u64 = 200;
const UPLOAD_CHUNK: u64 = 64 * 1024;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeedResult {
    pub latency_ms: f64,
    pub download_mbps: f64,
    pub upload_mbps: f64,
    pub downloaded_bytes: u64,
    pub uploaded_bytes: u64,
    pub concurrency: u32,
    pub rounds: u32,
    pub elapsed_ms: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeedProgressPayload {
    pub job_id: String,
    pub phase: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latency_ms: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bytes_done: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bytes_total: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mbps: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub concurrency: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub round: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rounds: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<SpeedResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

fn emit_progress(app: &AppHandle, payload: SpeedProgressPayload) {
    let _ = app.emit("network-speed-progress", payload);
}

fn mbps(bytes: u64, elapsed: Duration) -> f64 {
    let secs = elapsed.as_secs_f64().max(1e-6);
    (bytes as f64 * 8.0) / secs / 1_000_000.0
}

fn clamp_bytes(v: Option<u64>, default: u64) -> u64 {
    v.unwrap_or(default).clamp(MIN_BYTES, MAX_BYTES)
}

fn clamp_concurrency(v: Option<u32>) -> u32 {
    v.unwrap_or(4).clamp(MIN_CONCURRENCY, MAX_CONCURRENCY)
}

fn clamp_rounds(v: Option<u32>) -> u32 {
    v.unwrap_or(DEFAULT_ROUNDS).clamp(MIN_ROUNDS, MAX_ROUNDS)
}

fn median_f64(mut vals: Vec<f64>) -> f64 {
    if vals.is_empty() {
        return 0.0;
    }
    vals.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    vals[vals.len() / 2]
}

fn split_bytes(total: u64, n: u32) -> Vec<u64> {
    let n = n.max(1) as u64;
    let base = total / n;
    let rem = total % n;
    (0..n)
        .map(|i| base + if i < rem { 1 } else { 0 })
        .filter(|&x| x > 0)
        .collect()
}

fn build_download_url(template: &str, bytes: u64) -> String {
    if template.contains("{bytes}") {
        return template.replace("{bytes}", &bytes.to_string());
    }
    if template.contains("/__down") {
        if let Some(idx) = template.find('?') {
            return format!("{}?bytes={}", &template[..idx], bytes);
        }
        return format!("{template}?bytes={bytes}");
    }
    template.to_string()
}

async fn wait_cancel(cancel: &AtomicBool) {
    while !cancel.load(Ordering::SeqCst) {
        tokio::time::sleep(Duration::from_millis(40)).await;
    }
}

async fn measure_latency(
    client: &reqwest::Client,
    url: &str,
    cancel: &AtomicBool,
) -> Result<f64, String> {
    let probe = if url.contains("/__down") {
        if let Some(idx) = url.find('?') {
            format!("{}?bytes=0", &url[..idx])
        } else if url.contains("{bytes}") {
            url.replace("{bytes}", "0")
        } else {
            format!("{url}?bytes=0")
        }
    } else if url.contains("{bytes}") {
        url.replace("{bytes}", "65536")
    } else {
        url.to_string()
    };
    let mut samples = Vec::with_capacity(5);
    for _ in 0..5 {
        if cancel.load(Ordering::SeqCst) {
            return Err("cancelled".into());
        }
        let start = Instant::now();
        let resp = tokio::select! {
            biased;
            _ = wait_cancel(cancel) => return Err("cancelled".into()),
            r = client.get(&probe).send() => r.map_err(|e| e.to_string())?,
        };
        let _ = tokio::select! {
            biased;
            _ = wait_cancel(cancel) => return Err("cancelled".into()),
            r = resp.bytes() => r.map_err(|e| e.to_string())?,
        };
        samples.push(start.elapsed().as_secs_f64() * 1000.0);
    }
    samples.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    Ok(samples[samples.len() / 2])
}

async fn download_worker(
    client: reqwest::Client,
    url: String,
    cancel: Arc<AtomicBool>,
    done: Arc<AtomicU64>,
    failed: Arc<AtomicBool>,
) -> Result<(), String> {
    if cancel.load(Ordering::SeqCst) {
        return Ok(());
    }
    let resp = tokio::select! {
        biased;
        _ = wait_cancel(&cancel) => return Ok(()),
        r = client.get(&url).send() => match r {
            Ok(r) => r,
            Err(e) => {
                if cancel.load(Ordering::SeqCst) {
                    return Ok(());
                }
                failed.store(true, Ordering::SeqCst);
                cancel.store(true, Ordering::SeqCst);
                return Err(e.to_string());
            }
        },
    };
    if cancel.load(Ordering::SeqCst) {
        return Ok(());
    }
    if !resp.status().is_success() {
        failed.store(true, Ordering::SeqCst);
        cancel.store(true, Ordering::SeqCst);
        return Err(format!("HTTP {}", resp.status()));
    }
    let mut stream = resp.bytes_stream();
    loop {
        tokio::select! {
            biased;
            _ = wait_cancel(&cancel) => return Ok(()),
            item = stream.next() => {
                match item {
                    None => break,
                    Some(Ok(chunk)) => {
                        done.fetch_add(chunk.len() as u64, Ordering::Relaxed);
                    }
                    Some(Err(e)) => {
                        if cancel.load(Ordering::SeqCst) {
                            return Ok(());
                        }
                        failed.store(true, Ordering::SeqCst);
                        cancel.store(true, Ordering::SeqCst);
                        return Err(e.to_string());
                    }
                }
            }
        }
    }
    Ok(())
}

fn upload_stream(
    size: u64,
    done: Arc<AtomicU64>,
    cancel: Arc<AtomicBool>,
) -> impl stream::Stream<Item = Result<Bytes, std::io::Error>> + Send {
    stream::unfold(
        (size, done, cancel),
        |(remaining, done, cancel)| async move {
            if remaining == 0 || cancel.load(Ordering::SeqCst) {
                return None;
            }
            let n = remaining.min(UPLOAD_CHUNK) as usize;
            done.fetch_add(n as u64, Ordering::Relaxed);
            Some((
                Ok(Bytes::from(vec![0u8; n])),
                (remaining - n as u64, done, cancel),
            ))
        },
    )
}

async fn upload_worker(
    client: reqwest::Client,
    url: String,
    size: u64,
    cancel: Arc<AtomicBool>,
    done: Arc<AtomicU64>,
    failed: Arc<AtomicBool>,
) -> Result<(), String> {
    if cancel.load(Ordering::SeqCst) || size == 0 {
        return Ok(());
    }
    let body = reqwest::Body::wrap_stream(upload_stream(size, done.clone(), cancel.clone()));
    let resp = tokio::select! {
        biased;
        _ = wait_cancel(&cancel) => return Ok(()),
        r = client
            .post(&url)
            .header("content-type", "application/octet-stream")
            .body(body)
            .send() => match r {
            Ok(r) => r,
            Err(e) => {
                if cancel.load(Ordering::SeqCst) {
                    return Ok(());
                }
                failed.store(true, Ordering::SeqCst);
                cancel.store(true, Ordering::SeqCst);
                return Err(e.to_string());
            }
        },
    };
    let _ = tokio::select! {
        biased;
        _ = wait_cancel(&cancel) => return Ok(()),
        r = resp.bytes() => r,
    };
    Ok(())
}

/// Abort all workers as soon as cancel is set, then await (quick exit).
async fn settle_workers(
    handles: Vec<tokio::task::JoinHandle<Result<(), String>>>,
    cancel: Arc<AtomicBool>,
) -> Option<String> {
    let aborts: Vec<_> = handles.iter().map(|h| h.abort_handle()).collect();
    let cancel_w = cancel.clone();
    let watch = tokio::spawn(async move {
        wait_cancel(&cancel_w).await;
        for a in aborts {
            a.abort();
        }
    });

    let mut err: Option<String> = None;
    for h in handles {
        match h.await {
            Ok(Ok(())) => {}
            Ok(Err(e)) => {
                if err.is_none() && e != "cancelled" {
                    err = Some(e);
                }
            }
            Err(e) if e.is_cancelled() => {}
            Err(e) => {
                if err.is_none() {
                    err = Some(e.to_string());
                }
            }
        }
    }
    watch.abort();
    if cancel.load(Ordering::SeqCst) {
        return None; // treat as cancelled, not worker error
    }
    err
}

fn emit_error(
    app: &AppHandle,
    job: &str,
    latency_ms: Option<f64>,
    concurrency: u32,
    message: String,
    bytes_done: Option<u64>,
    bytes_total: Option<u64>,
    mbps_v: Option<f64>,
) {
    emit_progress(
        app,
        SpeedProgressPayload {
            job_id: job.to_string(),
            phase: "error".into(),
            latency_ms,
            bytes_done,
            bytes_total,
            mbps: mbps_v,
            concurrency: Some(concurrency),
            round: None,
            rounds: None,
            result: None,
            message: Some(message),
        },
    );
}

async fn run_download_pass(
    app: &AppHandle,
    job: &str,
    client: &reqwest::Client,
    dl_url: &str,
    total: u64,
    conc: u32,
    cancel: &Arc<AtomicBool>,
    latency_ms: f64,
    phase: &str,
    round: Option<u32>,
    rounds: Option<u32>,
) -> Result<(u64, f64), String> {
    if cancel.load(Ordering::SeqCst) {
        return Err("cancelled".into());
    }
    let parts = split_bytes(total, conc);
    let n = parts.len().max(1) as u32;
    let done = Arc::new(AtomicU64::new(0));
    let failed = Arc::new(AtomicBool::new(false));
    let start = Instant::now();
    let mut handles = Vec::new();
    for per in &parts {
        let url = build_download_url(dl_url, *per);
        handles.push(tokio::spawn(download_worker(
            client.clone(),
            url,
            cancel.clone(),
            done.clone(),
            failed.clone(),
        )));
    }
    let app_c = app.clone();
    let job_c = job.to_string();
    let done_c = done.clone();
    let cancel_c = cancel.clone();
    let phase_s = phase.to_string();
    let tick = tokio::spawn(async move {
        loop {
            if cancel_c.load(Ordering::SeqCst) {
                break;
            }
            let bytes_done = done_c.load(Ordering::Relaxed);
            emit_progress(
                &app_c,
                SpeedProgressPayload {
                    job_id: job_c.clone(),
                    phase: phase_s.clone(),
                    latency_ms: Some(latency_ms),
                    bytes_done: Some(bytes_done),
                    bytes_total: Some(total),
                    mbps: Some(mbps(bytes_done, start.elapsed())),
                    concurrency: Some(n),
                    round,
                    rounds,
                    result: None,
                    message: None,
                },
            );
            if bytes_done >= total {
                break;
            }
            tokio::time::sleep(Duration::from_millis(PROGRESS_INTERVAL_MS)).await;
        }
    });
    let err = settle_workers(handles, cancel.clone()).await;
    tick.abort();
    if cancel.load(Ordering::SeqCst) {
        return Err("cancelled".into());
    }
    if let Some(e) = err {
        return Err(e);
    }
    if failed.load(Ordering::SeqCst) {
        return Err("download failed".into());
    }
    let downloaded = done.load(Ordering::Relaxed);
    Ok((downloaded, mbps(downloaded, start.elapsed())))
}

async fn run_upload_pass(
    app: &AppHandle,
    job: &str,
    client: &reqwest::Client,
    ul_url: &str,
    total: u64,
    conc: u32,
    cancel: &Arc<AtomicBool>,
    latency_ms: f64,
    phase: &str,
    round: Option<u32>,
    rounds: Option<u32>,
) -> Result<(u64, f64), String> {
    if cancel.load(Ordering::SeqCst) {
        return Err("cancelled".into());
    }
    let parts = split_bytes(total, conc);
    let n = parts.len().max(1) as u32;
    let done = Arc::new(AtomicU64::new(0));
    let failed = Arc::new(AtomicBool::new(false));
    let start = Instant::now();
    let mut handles = Vec::new();
    for per in &parts {
        handles.push(tokio::spawn(upload_worker(
            client.clone(),
            ul_url.to_string(),
            *per,
            cancel.clone(),
            done.clone(),
            failed.clone(),
        )));
    }
    let app_c = app.clone();
    let job_c = job.to_string();
    let done_c = done.clone();
    let cancel_c = cancel.clone();
    let phase_s = phase.to_string();
    let tick = tokio::spawn(async move {
        loop {
            if cancel_c.load(Ordering::SeqCst) {
                break;
            }
            let bytes_done = done_c.load(Ordering::Relaxed);
            emit_progress(
                &app_c,
                SpeedProgressPayload {
                    job_id: job_c.clone(),
                    phase: phase_s.clone(),
                    latency_ms: Some(latency_ms),
                    bytes_done: Some(bytes_done),
                    bytes_total: Some(total),
                    mbps: Some(mbps(bytes_done, start.elapsed())),
                    concurrency: Some(n),
                    round,
                    rounds,
                    result: None,
                    message: None,
                },
            );
            if bytes_done >= total {
                break;
            }
            tokio::time::sleep(Duration::from_millis(PROGRESS_INTERVAL_MS)).await;
        }
    });
    let err = settle_workers(handles, cancel.clone()).await;
    tick.abort();
    if cancel.load(Ordering::SeqCst) {
        return Err("cancelled".into());
    }
    if let Some(e) = err {
        return Err(e);
    }
    if failed.load(Ordering::SeqCst) {
        return Err("upload failed".into());
    }
    let uploaded = done.load(Ordering::Relaxed);
    Ok((uploaded, mbps(uploaded, start.elapsed())))
}

/// å¯åŠ¨æµ‹é€Ÿä»»åŠ¡ï¼Œè¿”å›ž job_id
#[tauri::command]
pub async fn network_speed_test(
    app: AppHandle,
    state: State<'_, Arc<NetworkState>>,
    download_url: String,
    upload_url: String,
    download_bytes: Option<u64>,
    upload_bytes: Option<u64>,
    concurrency: Option<u32>,
    rounds: Option<u32>,
) -> Result<String, String> {
    let job_id = Uuid::new_v4().to_string();
    let cancel = Arc::new(AtomicBool::new(false));
    state.cancels.lock().insert(job_id.clone(), cancel.clone());

    let dl_total = clamp_bytes(download_bytes, DEFAULT_DOWNLOAD_BYTES);
    let ul_total = clamp_bytes(upload_bytes, DEFAULT_UPLOAD_BYTES);
    let conc = clamp_concurrency(concurrency);
    let rounds_n = clamp_rounds(rounds);
    let job = job_id.clone();
    let st = state.inner().clone();
    let dl_url = download_url.trim().to_string();
    let ul_url = upload_url.trim().to_string();

    if dl_url.is_empty() || ul_url.is_empty() {
        st.cancels.lock().remove(&job_id);
        return Err("download/upload url required".into());
    }

    tokio::spawn(async move {
        let overall = Instant::now();
        let client = match reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(5))
            .timeout(Duration::from_secs(120))
            .pool_max_idle_per_host(conc as usize)
            .build()
        {
            Ok(c) => c,
            Err(e) => {
                emit_error(&app, &job, None, conc, e.to_string(), None, None, None);
                st.cancels.lock().remove(&job);
                return;
            }
        };

        emit_progress(
            &app,
            SpeedProgressPayload {
                job_id: job.clone(),
                phase: "latency".into(),
                latency_ms: None,
                bytes_done: None,
                bytes_total: None,
                mbps: None,
                concurrency: Some(conc),
                round: None,
                rounds: Some(rounds_n),
                result: None,
                message: None,
            },
        );

        // More latency samples for stability
        let latency_ms = match measure_latency(&client, &dl_url, &cancel).await {
            Ok(v) => {
                emit_progress(
                    &app,
                    SpeedProgressPayload {
                        job_id: job.clone(),
                        phase: "latency".into(),
                        latency_ms: Some(v),
                        bytes_done: None,
                        bytes_total: None,
                        mbps: None,
                        concurrency: Some(conc),
                        round: None,
                        rounds: Some(rounds_n),
                        result: None,
                        message: None,
                    },
                );
                v
            }
            Err(e) => {
                emit_error(&app, &job, None, conc, e, None, None, None);
                st.cancels.lock().remove(&job);
                return;
            }
        };

        // â€”â€” warmup (discard) â€”â€”
        let warm_dl = (dl_total / 4).clamp(MIN_BYTES, dl_total);
        let warm_ul = (ul_total / 4).clamp(MIN_BYTES, ul_total);
        emit_progress(
            &app,
            SpeedProgressPayload {
                job_id: job.clone(),
                phase: "warmup".into(),
                latency_ms: Some(latency_ms),
                bytes_done: None,
                bytes_total: None,
                mbps: None,
                concurrency: Some(conc),
                round: Some(0),
                rounds: Some(rounds_n),
                result: None,
                message: Some("warmup".into()),
            },
        );
        if let Err(e) = run_download_pass(
            &app,
            &job,
            &client,
            &dl_url,
            warm_dl,
            conc,
            &cancel,
            latency_ms,
            "warmup",
            Some(0),
            Some(rounds_n),
        )
        .await
        {
            emit_error(&app, &job, Some(latency_ms), conc, e, None, None, None);
            st.cancels.lock().remove(&job);
            return;
        }
        if let Err(e) = run_upload_pass(
            &app,
            &job,
            &client,
            &ul_url,
            warm_ul,
            conc,
            &cancel,
            latency_ms,
            "warmup",
            Some(0),
            Some(rounds_n),
        )
        .await
        {
            emit_error(&app, &job, Some(latency_ms), conc, e, None, None, None);
            st.cancels.lock().remove(&job);
            return;
        }

        // â€”â€” measured download rounds â€”â€”
        let mut dl_rates = Vec::with_capacity(rounds_n as usize);
        let mut downloaded_sum = 0u64;
        for r in 1..=rounds_n {
            match run_download_pass(
                &app,
                &job,
                &client,
                &dl_url,
                dl_total,
                conc,
                &cancel,
                latency_ms,
                "download",
                Some(r),
                Some(rounds_n),
            )
            .await
            {
                Ok((bytes, rate)) => {
                    downloaded_sum += bytes;
                    dl_rates.push(rate);
                }
                Err(e) => {
                    emit_error(&app, &job, Some(latency_ms), conc, e, None, None, None);
                    st.cancels.lock().remove(&job);
                    return;
                }
            }
        }
        let download_mbps = median_f64(dl_rates);

        // â€”â€” measured upload rounds â€”â€”
        let mut ul_rates = Vec::with_capacity(rounds_n as usize);
        let mut uploaded_sum = 0u64;
        for r in 1..=rounds_n {
            match run_upload_pass(
                &app,
                &job,
                &client,
                &ul_url,
                ul_total,
                conc,
                &cancel,
                latency_ms,
                "upload",
                Some(r),
                Some(rounds_n),
            )
            .await
            {
                Ok((bytes, rate)) => {
                    uploaded_sum += bytes;
                    ul_rates.push(rate);
                }
                Err(e) => {
                    emit_error(
                        &app,
                        &job,
                        Some(latency_ms),
                        conc,
                        e,
                        None,
                        None,
                        Some(download_mbps),
                    );
                    st.cancels.lock().remove(&job);
                    return;
                }
            }
        }
        let upload_mbps = median_f64(ul_rates);

        emit_progress(
            &app,
            SpeedProgressPayload {
                job_id: job.clone(),
                phase: "done".into(),
                latency_ms: Some(latency_ms),
                bytes_done: Some(uploaded_sum),
                bytes_total: Some(ul_total * rounds_n as u64),
                mbps: Some(upload_mbps),
                concurrency: Some(conc),
                round: Some(rounds_n),
                rounds: Some(rounds_n),
                result: Some(SpeedResult {
                    latency_ms,
                    download_mbps,
                    upload_mbps,
                    downloaded_bytes: downloaded_sum,
                    uploaded_bytes: uploaded_sum,
                    concurrency: conc,
                    rounds: rounds_n,
                    elapsed_ms: overall.elapsed().as_millis() as u64,
                }),
                message: None,
            },
        );
        st.cancels.lock().remove(&job);
    });

    Ok(job_id)
}
