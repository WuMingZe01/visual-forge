/**
 * 图片上传Hook
 */
import { useCallback, useState } from 'react';
import type { ReferenceImage } from '@/types/tryon-types';
import { validateImageFile, formatFileSize } from '@/utils/image';

const MAX_FILE_SIZE = 50 * 1024 * 1024;

function genId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function useImageUpload(defaultType: 'model' | 'product_front' | 'product_back' | 'detail_ref' = 'product_front') {
  const [uploadError, setUploadError] = useState<string | null>(null);

  const handleFileSelect = useCallback(
    async (
      file: File,
      onSuccess: (image: ReferenceImage) => void,
      onError?: (msg: string) => void,
      type?: 'model' | 'product_front' | 'product_back' | 'detail_ref'
    ) => {
      setUploadError(null);

      const validation = validateImageFile(file, MAX_FILE_SIZE);
      if (!validation.valid) {
        const msg = validation.message || '文件验证失败';
        setUploadError(msg);
        onError?.(msg);
        return;
      }

      try {
        const previewUrl = URL.createObjectURL(file);
        const image: ReferenceImage = {
          id: genId(),
          type: type || defaultType,
          previewUrl,
          name: file.name,
          size: file.size,
        };
        onSuccess(image);
      } catch (e) {
        const msg = e instanceof Error ? e.message : '文件处理失败';
        setUploadError(msg);
        onError?.(msg);
      }
    },
    [defaultType]
  );

  const handleDrop = useCallback(
    async (
      e: React.DragEvent,
      onSuccess: (image: ReferenceImage) => void,
      onError?: (msg: string) => void
    ) => {
      e.preventDefault();
      e.stopPropagation();

      const files = Array.from(e.dataTransfer.files);
      if (files.length === 0) return;

      await handleFileSelect(files[0], onSuccess, onError);
    },
    [handleFileSelect]
  );

  const handleInputChange = useCallback(
    async (
      e: React.ChangeEvent<HTMLInputElement>,
      onSuccess: (image: ReferenceImage) => void,
      onError?: (msg: string) => void
    ) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;

      await handleFileSelect(files[0], onSuccess, onError);
      e.target.value = '';
    },
    [handleFileSelect]
  );

  return {
    uploadError,
    setUploadError,
    handleFileSelect,
    handleDrop,
    handleInputChange,
    formatFileSize,
    MAX_FILE_SIZE,
  };
}
