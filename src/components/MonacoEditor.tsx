/**
 * @file Monaco 编辑器封装
 * @description 先启用本地 monaco（非 CDN），再导出 @monaco-editor/react Editor。
 */

import "@/lib/editor/monacoSetup";
import Editor from "@monaco-editor/react";

export default Editor;
