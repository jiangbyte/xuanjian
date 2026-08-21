import * as ResizablePrimitive from "react-resizable-panels";

import { cn } from "@/lib/utils";

function ResizablePanelGroup({
  className,
  ...props
}: ResizablePrimitive.GroupProps) {
  return (
    <ResizablePrimitive.Group
      data-slot="resizable-panel-group"
      className={cn(
        "flex h-full w-full aria-[orientation=vertical]:flex-col",
        className,
      )}
      {...props}
    />
  );
}

function ResizablePanel({ ...props }: ResizablePrimitive.PanelProps) {
  return <ResizablePrimitive.Panel data-slot="resizable-panel" {...props} />;
}

/** 细线分隔：默认 1px，悬停/拖动时略加粗并点亮 primary */
function ResizableHandle({
  withHandle,
  className,
  ...props
}: ResizablePrimitive.SeparatorProps & {
  withHandle?: boolean;
}) {
  return (
    <ResizablePrimitive.Separator
      data-slot="resizable-handle"
      className={cn(
        "group/handle relative z-10 flex w-1.5 shrink-0 items-center justify-center bg-transparent transition-colors",
        "after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-border after:transition-[width,background-color] after:duration-150",
        "hover:after:w-0.5 hover:after:bg-primary active:after:w-0.5 active:after:bg-primary",
        "focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring",
        "aria-[orientation=horizontal]:h-1.5 aria-[orientation=horizontal]:w-full",
        "aria-[orientation=horizontal]:after:inset-x-0 aria-[orientation=horizontal]:after:top-1/2 aria-[orientation=horizontal]:after:bottom-auto aria-[orientation=horizontal]:after:left-0 aria-[orientation=horizontal]:after:h-px aria-[orientation=horizontal]:after:w-full aria-[orientation=horizontal]:after:translate-x-0 aria-[orientation=horizontal]:after:-translate-y-1/2",
        "aria-[orientation=horizontal]:hover:after:h-0.5 aria-[orientation=horizontal]:active:after:h-0.5",
        className,
      )}
      {...props}
    >
      {withHandle ? (
        <div
          className={cn(
            "z-10 rounded-full bg-border/80 opacity-0 transition-opacity duration-150",
            "group-hover/handle:opacity-100 group-active/handle:opacity-100",
            "h-8 w-0.5",
            "group-aria-[orientation=horizontal]/handle:h-0.5 group-aria-[orientation=horizontal]/handle:w-8",
          )}
        />
      ) : null}
    </ResizablePrimitive.Separator>
  );
}

export { ResizableHandle, ResizablePanel, ResizablePanelGroup };
