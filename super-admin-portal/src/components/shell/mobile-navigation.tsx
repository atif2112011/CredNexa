"use client";

import { Menu, X } from "lucide-react";
import { useState } from "react";

import { Sidebar } from "@/components/shell/sidebar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

export function MobileNavigation() {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="icon-lg" aria-label="Open navigation menu">
          <Menu className="h-5 w-5" aria-hidden="true" />
        </Button>
      </DialogTrigger>
      <DialogContent
        showCloseButton={false}
        className="top-0 left-0 h-dvh w-[min(85vw,280px)] max-w-[280px] translate-x-0 translate-y-0 gap-0 overflow-hidden rounded-none border-0 bg-sidebar p-0 text-sidebar-foreground ring-0 sm:max-w-[280px]"
      >
        <DialogTitle className="sr-only">Admin navigation</DialogTitle>
        <DialogClose asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-lg"
            className="absolute top-5 right-3 z-10 text-white/70 hover:bg-white/10 hover:text-white"
            aria-label="Close navigation menu"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </Button>
        </DialogClose>
        <Sidebar onNavigate={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}
