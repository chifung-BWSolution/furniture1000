import type { CSSProperties, ReactNode } from 'react';
import {
  PDF_CONTENT_WIDTH_MM,
  frameInSlot,
  imageRect,
  type PhotoBlockGeometry,
  type PhotoPlacement,
  type PhotoSlotRect,
} from '@/lib/quotePhotoLayouts';

export type LayoutPhotoSource = { title: string; previewUrl: string; generated?: boolean };

const pct = (value: number) => `${value * 100}%`;

/** 圖片在框內的位置：cover 用 object-position 平移，並以同一點為原點縮放。 */
export function PlacedPhoto({
  placement,
  photo,
  crossOrigin = true,
}: {
  placement: PhotoPlacement;
  photo: LayoutPhotoSource;
  crossOrigin?: boolean;
}) {
  const cover = placement.fitMode === 'cover';
  const position = `${pct(placement.offsetX)} ${pct(placement.offsetY)}`;
  const style: CSSProperties = cover
    ? {
        objectFit: 'cover',
        objectPosition: position,
        transform: placement.scale > 1 ? `scale(${placement.scale})` : undefined,
        transformOrigin: position,
      }
    : { objectFit: 'contain' };
  return (
    <img
      src={photo.previewUrl}
      alt={photo.title}
      crossOrigin={crossOrigin ? 'anonymous' : undefined}
      draggable={false}
      className="fds-photo-layout-img"
      style={style}
    />
  );
}

/**
 * 一個固定長寬比的排版區塊。槽位與框都用百分比定位，
 * 所以卡片、編輯器畫布與 A4 頁面可以是同一份 markup。
 */
export function PhotoLayoutBlock({
  geometry,
  placements,
  photoFor,
  className = '',
  renderSlot,
  textFor,
}: {
  geometry: PhotoBlockGeometry;
  placements: PhotoPlacement[];
  photoFor: (assetId: string) => LayoutPhotoSource | undefined;
  className?: string;
  /** 編輯器與卡片會包一層（drop 目標、點擊裁剪、空槽提示）。 */
  renderSlot?: (slot: PhotoSlotRect, placement: PhotoPlacement | undefined, content: ReactNode) => ReactNode;
  /** L05 圖片旁邊的文字區。 */
  textFor?: (placement: PhotoPlacement | undefined) => ReactNode;
}) {
  return (
    <div className="w-full">
      <div
        className={`fds-photo-layout ${className}`}
        style={{ aspectRatio: `${PDF_CONTENT_WIDTH_MM} / ${geometry.heightMm}` }}
      >
        {geometry.slots.map((slot) => {
          const placement = placements.find((entry) => entry.slotId === slot.id);
          const photo = placement ? photoFor(placement.assetId) : undefined;
          const area = imageRect(slot, geometry);
          const imageShare = area.h / slot.h;
          const frame = placement ? frameInSlot(area, geometry.heightMm, placement) : null;
          const content =
            placement && photo && frame ? (
              <>
                <div className="fds-photo-layout-image" style={{ height: pct(imageShare) }}>
                  <div
                    className="fds-photo-layout-frame"
                    style={{
                      left: pct(frame.left),
                      top: pct(frame.top),
                      width: pct(frame.width),
                      height: pct(frame.height),
                    }}
                  >
                    <PlacedPhoto placement={placement} photo={photo} />
                  </div>
                </div>
                {geometry.captionMm ? (
                  <p className="fds-photo-layout-slot-caption" style={{ height: pct(1 - imageShare) }}>
                    {placement.caption}
                  </p>
                ) : null}
              </>
            ) : null;
          return (
            <div
              key={slot.id}
              className="fds-photo-layout-slot"
              style={{ left: pct(slot.x), top: pct(slot.y), width: pct(slot.w), height: pct(slot.h) }}
            >
              {renderSlot ? renderSlot(slot, placement, content) : content}
            </div>
          );
        })}
        {geometry.text ? (
          <div
            className="fds-photo-layout-text"
            style={{
              left: pct(geometry.text.x),
              top: pct(geometry.text.y),
              width: pct(geometry.text.w),
              height: pct(geometry.text.h),
            }}
          >
            {textFor?.(placements[0])}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** L05 印在圖旁的標題＋說明。 */
export function PhotoLayoutCaption({ placement }: { placement: PhotoPlacement | undefined }) {
  if (!placement?.title && !placement?.caption) return null;
  return (
    <>
      {placement.title ? <p className="fds-photo-layout-title">{placement.title}</p> : null}
      {placement.caption ? <p className="fds-photo-layout-caption">{placement.caption}</p> : null}
    </>
  );
}
