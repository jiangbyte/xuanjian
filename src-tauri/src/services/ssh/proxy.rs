//! SSH 代理：SOCKS5 / HTTP CONNECT。
//!
//! Author: Charlie

use anyhow::{anyhow, Context, Result};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

#[derive(Debug, Clone)]
pub struct ProxyConfig {
    pub proxy_type: String,
    pub proxy_host: String,
    pub proxy_port: u16,
}

pub async fn connect_via_proxy(
    proxy: &ProxyConfig,
    target_host: &str,
    target_port: u16,
) -> Result<TcpStream> {
    match proxy.proxy_type.to_ascii_lowercase().as_str() {
        "socks5" | "socks" => {
            connect_socks5(
                &proxy.proxy_host,
                proxy.proxy_port,
                target_host,
                target_port,
            )
            .await
        }
        "http" | "https" => {
            connect_http_connect(
                &proxy.proxy_host,
                proxy.proxy_port,
                target_host,
                target_port,
            )
            .await
        }
        other => Err(anyhow!(
            "unsupported SSH proxy type: {other} (supported: socks5, http)"
        )),
    }
}

async fn connect_socks5(
    proxy_host: &str,
    proxy_port: u16,
    target_host: &str,
    target_port: u16,
) -> Result<TcpStream> {
    let mut stream = TcpStream::connect((proxy_host, proxy_port))
        .await
        .with_context(|| format!("connect to SOCKS5 proxy {proxy_host}:{proxy_port}"))?;

    stream.write_all(&[0x05, 0x01, 0x00]).await?;
    let mut method = [0u8; 2];
    stream.read_exact(&mut method).await?;
    if method[0] != 0x05 || method[1] != 0x00 {
        return Err(anyhow!("SOCKS5 proxy rejected auth method"));
    }

    let host_bytes = target_host.as_bytes();
    if host_bytes.is_empty() || host_bytes.len() > 255 {
        return Err(anyhow!("invalid target host for SOCKS5"));
    }
    let mut req = Vec::with_capacity(7 + host_bytes.len());
    req.push(0x05);
    req.push(0x01);
    req.push(0x00);
    req.push(0x03);
    req.push(host_bytes.len() as u8);
    req.extend_from_slice(host_bytes);
    req.extend_from_slice(&target_port.to_be_bytes());
    stream.write_all(&req).await?;

    let mut head = [0u8; 4];
    stream.read_exact(&mut head).await?;
    if head[0] != 0x05 || head[1] != 0x00 {
        return Err(anyhow!("SOCKS5 connect failed (code {})", head[1]));
    }
    match head[3] {
        0x01 => {
            let mut rest = [0u8; 6];
            stream.read_exact(&mut rest).await?;
        }
        0x03 => {
            let mut len = [0u8; 1];
            stream.read_exact(&mut len).await?;
            let mut rest = vec![0u8; usize::from(len[0]) + 2];
            stream.read_exact(&mut rest).await?;
        }
        0x04 => {
            let mut rest = [0u8; 18];
            stream.read_exact(&mut rest).await?;
        }
        other => return Err(anyhow!("SOCKS5 unknown address type {other}")),
    }
    Ok(stream)
}

async fn connect_http_connect(
    proxy_host: &str,
    proxy_port: u16,
    target_host: &str,
    target_port: u16,
) -> Result<TcpStream> {
    let mut stream = TcpStream::connect((proxy_host, proxy_port))
        .await
        .with_context(|| format!("connect to HTTP proxy {proxy_host}:{proxy_port}"))?;

    let req = format!(
        "CONNECT {target_host}:{target_port} HTTP/1.1\r\nHost: {target_host}:{target_port}\r\nProxy-Connection: Keep-Alive\r\n\r\n"
    );
    stream.write_all(req.as_bytes()).await?;

    let mut buf = Vec::with_capacity(512);
    let mut chunk = [0u8; 256];
    loop {
        let n = stream.read(&mut chunk).await?;
        if n == 0 {
            return Err(anyhow!("HTTP proxy closed before CONNECT response"));
        }
        buf.extend_from_slice(&chunk[..n]);
        if buf.windows(4).any(|w| w == b"\r\n\r\n") {
            break;
        }
        if buf.len() > 8192 {
            return Err(anyhow!("HTTP proxy CONNECT response too large"));
        }
    }
    let text = String::from_utf8_lossy(&buf);
    let status_line = text.lines().next().unwrap_or("");
    if !status_line.contains(" 200 ") {
        return Err(anyhow!("HTTP CONNECT failed: {status_line}"));
    }
    Ok(stream)
}

pub async fn open_tcp(
    target_host: &str,
    target_port: u16,
    proxy: Option<&ProxyConfig>,
) -> Result<TcpStream> {
    if let Some(proxy) = proxy {
        connect_via_proxy(proxy, target_host, target_port).await
    } else {
        TcpStream::connect((target_host, target_port))
            .await
            .with_context(|| format!("tcp connect {target_host}:{target_port}"))
    }
}
