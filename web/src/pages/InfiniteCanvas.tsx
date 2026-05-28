import { useEffect } from 'react';

export function InfiniteCanvas() {
  useEffect(() => {
    window.location.replace('/infinite-canvas/index.html');
  }, []);

  return null;
}
