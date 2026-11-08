import { useEffect, useState } from "react";
import { Git } from "./mygo";
import type { ImageData } from "./mygo";
import { imageSource } from "./images";
import { useT } from "./i18n";
import { Spinner, cx } from "./ui";

const T = {
  en: {
    before: "Before",
    after: "After",
    missing: "No image in this version",
    loading: "Loading the image",
    overlay: "Overlay",
    sideBySide: "Side by side",
    opacity: "Opacity",
    tooLarge: "The image could not be read",
  },
  zh: {
    before: "修改前",
    after: "修改后",
    missing: "此版本没有图片",
    loading: "正在加载图片",
    overlay: "叠加",
    sideBySide: "并排",
    opacity: "不透明度",
    tooLarge: "无法读取该图片",
  },
} as const;

function useImage(path: string, revision: string): { image: ImageData | null; missing: boolean } {
  const [image, setImage] = useState<ImageData | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let alive = true;
    setImage(null);
    setMissing(false);
    Git.image(path, revision)
      .then((data) => {
        if (alive) setImage(data);
      })
      .catch(() => {
        if (alive) setMissing(true);
      });
    return () => {
      alive = false;
    };
  }, [path, revision]);
  return { image, missing };
}

/** ImageDiff draws the two versions of an image, side by side or one over
 *  the other with an opacity slider, which is how IDEA compares images. */
export function ImageDiff({
  path,
  oldPath,
  before,
  after,
  single,
}: {
  path: string;
  oldPath?: string;
  before: string;
  after: string;
  /** One revision only: the source view, not a diff. */
  single?: boolean;
}) {
  const t = useT(T);
  const [mode, setMode] = useState<"split" | "overlay">("split");
  const [opacity, setOpacity] = useState(50);
  const left = useImage(oldPath || path, before);
  const right = useImage(path, after);
  const loaded = left.image !== null || right.image !== null;
  const failed = left.missing && right.missing;

  const pane = (image: ImageData | null, missing: boolean, side: "before" | "after") =>
    missing ? (
      <div className="image-empty">{t("missing")}</div>
    ) : image ? (
      <img className="image-pane-img" src={imageSource(image)} alt={t(side)} draggable={false} />
    ) : (
      <div className="image-empty">
        <Spinner label={t("loading")} />
      </div>
    );

  if (single) {
    return (
      <div className="image-diff single">
        {failed ? <div className="image-empty">{t("tooLarge")}</div> : pane(right.image, right.missing, "after")}
      </div>
    );
  }

  return (
    <div className="image-diff-wrap">
      <div className="image-diff-bar">
        <button className={cx("toolbar-text-btn", mode === "split" && "active")} onClick={() => setMode("split")}>
          {t("sideBySide")}
        </button>
        <button className={cx("toolbar-text-btn", mode === "overlay" && "active")} onClick={() => setMode("overlay")}>
          {t("overlay")}
        </button>
        {mode === "overlay" && (
          <>
            <span className="muted">{t("opacity")}</span>
            <input
              type="range"
              min={0}
              max={100}
              value={opacity}
              onChange={(e) => setOpacity(Number(e.target.value))}
            />
          </>
        )}
      </div>
      {!loaded && !failed && (
        <div className="image-empty">
          <Spinner label={t("loading")} />
        </div>
      )}
      {failed && <div className="image-empty">{t("tooLarge")}</div>}
      {loaded && mode === "split" && (
        <div className="image-split">
          <div className="image-side">
            <div className="image-label">{t("before")}</div>
            {pane(left.image, left.missing, "before")}
          </div>
          <div className="image-side">
            <div className="image-label">{t("after")}</div>
            {pane(right.image, right.missing, "after")}
          </div>
        </div>
      )}
      {loaded && mode === "overlay" && (
        <div className="image-overlay">
          {pane(left.image, left.missing, "before")}
          <div className="image-overlay-top" style={{ opacity: opacity / 100 }}>
            {pane(right.image, right.missing, "after")}
          </div>
          <span className="image-label overlay-left">{t("before")}</span>
          <span className="image-label overlay-right">{t("after")}</span>
        </div>
      )}
    </div>
  );
}
