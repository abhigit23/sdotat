import {
  File,
  FileArchive,
  FileCode,
  FileImage,
  FileMusic,
  FileText,
  FileVideoCamera,
} from "lucide-react";

const ARCHIVE_EXT = /\.(zip|rar|7z|tar|gz|tgz|bz2|xz)$/i;
const CODE_EXT =
  /\.(js|jsx|ts|tsx|json|html|css|py|rb|go|rs|java|c|cpp|h|sh|sql|xml|ya?ml|toml)$/i;

/**
 * Small icon hinting at a file's type, chosen from its MIME type with a
 * filename-extension fallback (browsers often report an empty type).
 */
export default function FileIcon({
  name,
  mime,
  size = 14,
  className,
}: {
  name: string;
  mime: string;
  size?: number;
  className?: string;
}) {
  const props = { size, className, "aria-hidden": true } as const;
  if (mime.startsWith("image/")) return <FileImage {...props} />;
  if (mime.startsWith("video/")) return <FileVideoCamera {...props} />;
  if (mime.startsWith("audio/")) return <FileMusic {...props} />;
  if (ARCHIVE_EXT.test(name) || /zip|compressed|x-tar/.test(mime)) {
    return <FileArchive {...props} />;
  }
  if (CODE_EXT.test(name) || /json|xml|javascript/.test(mime)) {
    return <FileCode {...props} />;
  }
  if (mime.startsWith("text/") || mime === "application/pdf") {
    return <FileText {...props} />;
  }
  return <File {...props} />;
}
