'use client';

import React, { useEffect, useState } from 'react';
import { X, ZoomIn, ZoomOut, Download } from 'lucide-react';

interface ImageLightboxProps {
  src: string | null;
  title?: string;
  onClose: () => void;
}

export function ImageLightbox({ src, title = 'Document Preview', onClose }: ImageLightboxProps) {
  const [zoomed, setZoomed] = useState(false);

  useEffect(() => {
    if (!src) return;
    setZoomed(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [src, onClose]);

  if (!src) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/75 backdrop-blur-md p-4 sm:p-6 animate-in fade-in duration-150"
      onClick={onClose}
    >
      {/* Top Floating Bar */}
      <div
        className="max-w-5xl w-full mx-auto flex items-center justify-between gap-3 rounded-full px-4 py-2 bg-white/10 border border-white/15 text-white backdrop-blur-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="text-xs font-medium truncate">{title}</span>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => setZoomed((z) => !z)}
            className="p-1.5 rounded-full hover:bg-white/15 transition-colors"
            title={zoomed ? 'Zoom out' : 'Zoom in'}
          >
            {zoomed ? <ZoomOut className="w-4 h-4" /> : <ZoomIn className="w-4 h-4" />}
          </button>
          <a
            href={src}
            download
            target="_blank"
            rel="noreferrer"
            className="p-1.5 rounded-full hover:bg-white/15 transition-colors"
            title="Open original"
          >
            <Download className="w-4 h-4" />
          </a>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-white/15 transition-colors"
            aria-label="Close preview"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Image Canvas */}
      <div
        className="flex-1 flex items-center justify-center overflow-auto py-4"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={src}
          alt={title}
          onClick={() => setZoomed((z) => !z)}
          className={`rounded-2xl border border-white/15 shadow-2xl transition-transform duration-200 cursor-zoom-in ${
            zoomed ? 'max-h-none max-w-none scale-125 cursor-zoom-out' : 'max-h-[82vh] max-w-full object-contain'
          }`}
        />
      </div>
    </div>
  );
}

