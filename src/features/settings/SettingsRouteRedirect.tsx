/**
 * @file /settings 路由兼容：打开设置弹窗并回到首页
 */

import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useUiStore } from "@/stores/ui";

export function SettingsRouteRedirect() {
  const navigate = useNavigate();
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);

  useEffect(() => {
    setSettingsOpen(true);
    navigate("/", { replace: true });
  }, [navigate, setSettingsOpen]);

  return null;
}
