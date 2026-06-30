import { useEffect, useState } from 'react';

const DEFAULT_CAPTIONS = ['正在思考', '翻找工具', '理一理思路', '推演一下', '组织语言'];

/**
 * 等待态：手绘小人在虚线地面上一蹦一蹦地跑（带挤压拉伸 + 收缩影子），
 * 配一句手写体提示。复用 #agentma napkin 笔触符号，墨色随当前文字色。
 */
export default function MascotRunner({
  caption,
  captions = DEFAULT_CAPTIONS,
  height = 88,
}: {
  caption?: string;
  captions?: string[];
  height?: number;
}) {
  useEffect(() => { window.installMascot?.(); }, []);

  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (caption) return;
    const t = setInterval(() => setIdx(i => (i + 1) % captions.length), 2400);
    return () => clearInterval(t);
  }, [caption, captions.length]);

  const text = caption ?? captions[idx];

  return (
    <div
      className="mascot-runner"
      style={{ ['--mr-h' as string]: `${height}px` } as React.CSSProperties}
      role="status"
      aria-live="polite"
      aria-label={`${text}…`}
    >
      <div className="mascot-runner__stage" aria-hidden="true">
        <div className="mascot-runner__runner">
          <span className="mascot-runner__shadow" />
          <span className="mascot-runner__body">
            <svg viewBox="0 0 650 737" preserveAspectRatio="xMidYMid meet">
              <use href="#agentma" />
            </svg>
          </span>
        </div>
        <div className="mascot-runner__ground" />
      </div>
      <div className="mascot-runner__caption">
        <span key={text} className="mascot-runner__word">{text}</span>
        <span className="mascot-runner__dots" aria-hidden="true"><i>.</i><i>.</i><i>.</i></span>
      </div>
    </div>
  );
}
