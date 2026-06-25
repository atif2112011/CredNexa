"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";

type ImageViewerModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  imageUrl?: string;
  title?: string;
  description?: string;
};

export function ImageViewerModal({
  open,
  onOpenChange,
  imageUrl,
  title = "Image Preview",
  description = "Proof image preview"
}: ImageViewerModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {imageUrl ? (
          <div className="flex max-h-[72vh] items-center justify-center overflow-hidden rounded-lg border bg-muted/20">
            <img src={imageUrl} alt={title} className="max-h-[72vh] w-auto max-w-full object-contain" />
          </div>
        ) : (
          <div className="rounded-lg border bg-muted/20 px-4 py-10 text-center text-sm text-muted-foreground">
            No image available.
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
