import { useState, useRef, useEffect } from 'react';
import { loadImage } from '@/services/imageStore';
import { Image, Loader2 } from 'lucide-react';

interface LazyImageProps {
  /** IndexedDB key for thumbnail (e.g. style_BM001_front_thumb) */
  thumbKey: string;
  /** IndexedDB key for full-resolution image. If omitted, clicking won't open full. */
  fullKey?: string;
  /** CSS classes for the img element */
  className?: string;
  /** Alt text */
  alt?: string;
  /** Show a spinner placeholder while loading */
  showSpinner?: boolean;
}

/**
 * IntersectionObserver-driven lazy image loader.
 * Loads thumbnail from IndexedDB only when the element enters the viewport.
 * Clicking opens the full-resolution image in a new tab.
 */
export function LazyImage({ thumbKey, fullKey, className, alt = '', showSpinner = true }: LazyImageProps) {
  const [src, setSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const loadedRef = useRef(false);

  useEffect(() => {
    if (loadedRef.current) return;
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            loadedRef.current = true;
            observer.disconnect();
            setLoading(true);
            loadImage(thumbKey)
              .then((b64) => {
                if (b64) { setSrc(b64); setError(false); }
                else { setError(true); }
              })
              .catch(() => setError(true))
              .finally(() => setLoading(false));
          }
        }
      },
      { rootMargin: '200px' } // preload 200px before visible
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [thumbKey]);

  const handleClick = () => {
    if (!fullKey) return;
    loadImage(fullKey).then((b64) => {
      if (b64) window.open(b64, '_blank');
    });
  };

  return (
    <div ref={ref} className={`flex items-center justify-center overflow-hidden ${className || ''}`}>
      {loading && showSpinner && <Loader2 size={14} className="animate-spin text-forge-text2/40" />}
      {error && !src && <Image size={18} className="text-forge-text2/20" />}
      {src && (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          className={`w-full h-full object-cover ${fullKey ? 'cursor-pointer hover:ring-2 hover:ring-forge-cyan/50' : ''}`}
          onClick={fullKey ? handleClick : undefined}
        />
      )}
    </div>
  );
}
