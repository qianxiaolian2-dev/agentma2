import type { ChatAttachment, ChatFileAttachment, ChatImageAttachment, ChatImageMimeType } from '../simulator/types';

export const CHAT_IMAGE_MIME_TYPES = new Set<ChatImageMimeType>(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
export const CHAT_IMAGE_MAX_COUNT = 4;
export const CHAT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const CHAT_FILE_MAX_COUNT = 6;
export const CHAT_FILE_MAX_BYTES = 2 * 1024 * 1024;
export const CHAT_FILE_EXTENSIONS = [
  '.md', '.markdown', '.txt', '.csv', '.json', '.yaml', '.yml', '.xml', '.html',
  '.svg', '.js', '.jsx', '.ts', '.tsx', '.py', '.java', '.go', '.rs', '.sql', '.log', '.xls', '.xlsx',
];
export const CHAT_FILE_ACCEPT = CHAT_FILE_EXTENSIONS.join(',');

export function formatAttachmentBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function getChatImageSrc(image: ChatImageAttachment): string {
  return `data:${image.mediaType};base64,${image.data}`;
}

function readFileDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.onload = () => resolve(String(reader.result || ''));
    reader.readAsDataURL(file);
  });
}

function dataUrlPayload(dataUrl: string) {
  return dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
}

export function isSupportedChatFile(file: File) {
  const name = file.name.toLowerCase();
  return CHAT_FILE_EXTENSIONS.some((extension) => name.endsWith(extension));
}

export function uniqueChatImageFiles(files: File[]) {
  const seen = new Set<string>();
  return files.flatMap((file) => {
    if (!file.type.startsWith('image/')) return [];
    const key = `${file.type}:${file.size}:${file.lastModified || 0}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [file];
  });
}

export async function fileToChatAttachment(file: File): Promise<ChatAttachment> {
  if (CHAT_IMAGE_MIME_TYPES.has(file.type as ChatImageMimeType)) {
    if (file.size > CHAT_IMAGE_MAX_BYTES) throw new Error('单张图片不能超过 5MB');
    const data = dataUrlPayload(await readFileDataUrl(file));
    if (!data) throw new Error('图片数据为空');
    return {
      id: crypto.randomUUID(),
      type: 'image',
      mediaType: file.type as ChatImageMimeType,
      data,
      name: file.name || 'image',
      size: file.size,
    } satisfies ChatImageAttachment;
  }

  if (!isSupportedChatFile(file)) throw new Error(`不支持这个文件类型: ${file.name}`);
  if (file.size > CHAT_FILE_MAX_BYTES) throw new Error(`单个文件不能超过 ${formatAttachmentBytes(CHAT_FILE_MAX_BYTES)}: ${file.name}`);
  const data = dataUrlPayload(await readFileDataUrl(file));
  if (!data) throw new Error('文件数据为空');
  return {
    id: crypto.randomUUID(),
    type: 'file',
    mediaType: file.type || 'application/octet-stream',
    data,
    name: file.name || 'file',
    size: file.size,
  } satisfies ChatFileAttachment;
}
