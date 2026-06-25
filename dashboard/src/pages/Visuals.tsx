import { Link } from 'react-router-dom';
import VisualsLegacy from './VisualsLegacy';
import './pages-visuals.css';

export default function Visuals() {
  return (
    <div className="visuals-shell">
      <div className="page-header visuals-page-header">
        <div className="visuals-header-copy">
          <h1>HTML 素材库</h1>
          <p>这里只保留你在会话里确认并保存下来的 HTML 页面版本。页面生成和改版都回到会话里完成，这里负责归档、打开、继续修改和删除。</p>
        </div>
        <div className="visuals-header-actions">
          <Link className="btn btn-primary" to="/conversations?agent=viz-agent">
            去会话生成页面
          </Link>
          <span className="visuals-header-note">
            使用流程：会话里生成预览，预览页点击“保存”，再回这里继续修改或管理历史页面。
          </span>
        </div>
      </div>

      <div className="visuals-guide-grid">
        <article className="card visuals-guide-card">
          <span className="visuals-guide-kicker">1. 会话生成</span>
          <strong>先在会话里选模型和可视化助手</strong>
          <p>页面设计、改标题、换结构、加模块都在会话里完成，不在素材库里直接编辑。</p>
        </article>
        <article className="card visuals-guide-card">
          <span className="visuals-guide-kicker">2. 预览保存</span>
          <strong>满意后保存成正式页面版本</strong>
          <p>预览页保存后，这份 HTML 会进入素材库，不再只是一次性的临时链接。</p>
        </article>
        <article className="card visuals-guide-card">
          <span className="visuals-guide-kicker">3. 继续修改</span>
          <strong>从素材库回到会话继续迭代</strong>
          <p>点击“继续修改”会把已保存 HTML 带回会话，直接基于当前版本继续改，而不是从零重做。</p>
        </article>
      </div>

      <section className="card visuals-archive-card">
        <div className="visuals-archive-note">
          <strong>归档说明</strong>
          <p>下面保存的是已经确认过的页面版本。可以先打开核对原始页面，再点“继续修改”发起下一轮改版。</p>
        </div>
        <VisualsLegacy embedded />
      </section>
    </div>
  );
}
