/**
 * @file 移动端顶部栏
 */

import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function MobileTopBar({
  title,
  onBack,
  right,
  className,
}: {
  title: string;
  onBack?: () => void;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "flex h-12 shrink-0 items-center gap-1 border-b border-border bg-sidebar px-2 pt-[env(safe-area-inset-top)]",
        className,
      )}
    >
      {onBack ? (
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label="返回"
          onClick={onBack}
        >
          <ChevronLeft size={18} />
        </Button>
      ) : (
        <span className="w-8" />
      )}
      <h1 className="min-w-0 flex-1 truncate text-center text-sm font-semibold">
        {title}
      </h1>
      <div className="flex min-w-8 items-center justify-end gap-1">{right}</div>
    </header>
  );
}
