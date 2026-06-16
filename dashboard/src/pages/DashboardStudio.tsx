import { Link } from 'react-router-dom';
import { useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';

type InputMode = 'dataset' | 'metric';

type TopicSpec = {
  name: string;
  type: string;
  summary: string;
};

function inferMetricFromDataset(fileNames: string[]) {
  const joined = fileNames.join(' ').toLowerCase();
  if (/回款|应收|账龄/.test(joined)) return '回款金额';
  if (/库存|出库|入库/.test(joined)) return '库存金额';
  if (/线索|商机|转化/.test(joined)) return '线索转化率';
  if (/毛利|利润/.test(joined)) return '毛利额';
  if (/合同|签约|销售/.test(joined)) return '签约金额';
  return '核心结果指标';
}

function inferBusinessFromDataset(fileNames: string[]) {
  const joined = fileNames.join(' ').toLowerCase();
  if (/回款|应收|账龄/.test(joined)) return '回款与应收';
  if (/库存|出库|入库/.test(joined)) return '库存运营';
  if (/线索|商机|转化/.test(joined)) return '线索转化';
  if (/毛利|利润/.test(joined)) return '利润分析';
  if (/合同|签约|销售/.test(joined)) return '销售执行';
  return '通用经营分析';
}

function recommendTopics(metric: string): TopicSpec[] {
  if (metric.includes('回款') || metric.includes('应收')) {
    return [
      { name: '回款进度', type: '结果', summary: '看本期回款、累计达成、兑现节奏是否跟上。' },
      { name: '应收风险', type: '风险', summary: '拆未到期、已逾期、长账龄，判断催收优先级。' },
      { name: '区域断点', type: '责任', summary: '定位哪些区域或业务员拖慢回款兑现。' },
      { name: '客户结构', type: '质量', summary: '看大客户、新客、项目型客户对回款结构的影响。' },
    ];
  }

  if (metric.includes('签约') || metric.includes('销售') || metric.includes('合同')) {
    return [
      { name: '执行进度', type: '过程', summary: '看签约后的发货、开票、验收、回款链路是否闭环。' },
      { name: '供给与储备', type: '供给', summary: '看未来可兑现池子是否足够，是否存在标称虚高。' },
      { name: '区域表现', type: '责任', summary: '定位高贡献和高拖累区域，明确下一步动作。' },
      { name: '异常合同', type: '风险', summary: '找出未发货、未开票、未回款的高风险合同。' },
    ];
  }

  return [
    { name: '结果总览', type: '结果', summary: '先回答指标达成了吗、趋势怎样、组织差异在哪。' },
    { name: '过程效率', type: '过程', summary: '看结果形成链路是否顺畅，哪一段最卡。' },
    { name: '结构质量', type: '结构', summary: '看客户、产品、渠道、区域结构是否拉低结果。' },
    { name: '风险预警', type: '风险', summary: '把高风险对象、逾期事项、异常波动单独拉出来。' },
  ];
}

function buildPreview(metric: string, business: string, mode: InputMode, datasetName: string) {
  const isMoney = /金额|GMV|收入|回款|签约|库存/.test(metric);
  const unit = isMoney ? '万' : '%';
  const mainValue = isMoney ? '8,460' : '74.6';
  const targetValue = isMoney ? '92.4%' : '82.1%';
  const riskValue = isMoney ? '1,280' : '12.4';

  return {
    title: `${metric}看板`,
    subtitle: mode === 'dataset'
      ? `基于数据集「${datasetName}」自动生成的第一版看板`
      : `基于指标「${metric}」和业务主题「${business}」自动生成的第一版看板`,
    kpis: [
      { label: `${metric}累计`, value: `${mainValue}${unit}`, sub: '结果主指标', tone: 'blue' },
      { label: `${metric}达成率`, value: targetValue, sub: '对照目标或预算', tone: 'green' },
      { label: '高风险金额', value: `${riskValue}${unit}`, sub: '需优先处理对象', tone: 'orange' },
      { label: '组织异常数', value: '6', sub: '建议下钻排查', tone: 'red' },
    ],
    trend: [42, 48, 51, 47, 54, 62, 58, 65, 71, 68, 76, 83],
    months: ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'],
    ranks: [
      { name: '华东一区', value: 1820, delta: '+12%' },
      { name: '华南二区', value: 1540, delta: '+8%' },
      { name: '华北一区', value: 1280, delta: '-4%' },
      { name: '西南一区', value: 960, delta: '-11%' },
    ],
    structures: [
      { name: '客户维度', left: '新客 38%', right: '老客 62%', ratio: 38 },
      { name: '产品维度', left: 'A 类 44%', right: '其他 56%', ratio: 44 },
      { name: '区域维度', left: 'TOP3 区域 58%', right: '其他 42%', ratio: 58 },
    ],
    rows: [
      { name: '上海某重点客户', owner: '张晨', risk: '回款延迟', action: '优先催收' },
      { name: '华南某项目单', owner: '李越', risk: '阶段停滞', action: '推进节点' },
      { name: '北京某大单', owner: '王璟', risk: '结构下滑', action: '复盘原因' },
    ],
  };
}

function defaultFields(mode: InputMode, metric: string) {
  if (mode === 'dataset') {
    return ['日期', '组织', '负责人', metric, '客户', '产品', '区域', '阶段'];
  }
  return ['时间粒度', '结果指标', '组织维度', '结构维度', '异常口径', '明细主键'];
}

function formatTime(ts: number) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(ts);
}

export default function DashboardStudio() {
  const [mode, setMode] = useState<InputMode>('dataset');
  const [metric, setMetric] = useState('签约金额');
  const [business, setBusiness] = useState('销售执行');
  const [datasetName, setDatasetName] = useState('sales_contracts_260614.xlsx');
  const [files, setFiles] = useState<string[]>(['销售合同明细.csv', '应收账龄.xlsx']);
  const [needPrototype, setNeedPrototype] = useState(true);
  const [generationAt, setGenerationAt] = useState(Date.now());
  const [hasGenerated, setHasGenerated] = useState(false);

  const topics = useMemo(() => recommendTopics(metric), [metric]);
  const fields = useMemo(() => defaultFields(mode, metric), [mode, metric]);
  const preview = useMemo(() => buildPreview(metric, business, mode, datasetName), [metric, business, mode, datasetName]);

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files || []).map(file => file.name);
    if (picked.length > 0) {
      setFiles(picked);
      setDatasetName(picked[0]);
      setMode('dataset');
      setMetric(inferMetricFromDataset(picked));
      setBusiness(inferBusinessFromDataset(picked));
      setGenerationAt(Date.now());
    }
  };

  const handleGenerate = () => {
    setGenerationAt(Date.now());
    setHasGenerated(true);
  };

  const intakeTitle = mode === 'dataset' ? '上传数据集' : '输入一个指标';
  const generatedCopy = mode === 'dataset'
    ? `已识别样本「${datasetName}」，会先从数据里找时间字段、组织字段和主结果字段。`
    : `已基于指标「${metric}」生成第一版看板结构，默认先出总览页和 2 张专题页。`;

  return (
    <div className="fade-in">
      <div className="studio-topbar">
        <div>
          <div className="studio-topbar-brand">Dashboard Studio</div>
          <div className="studio-topbar-copy">给数据集，或给一个指标，直接生成看板结构。</div>
        </div>
        <Link to="/" className="btn">返回 AgentMa</Link>
      </div>

      <div className="studio-intro">
        <h1>先给输入，再生成看板</h1>
        <p>用户在这里主要只做两件事：上传数据集，或者输入指标。其余内容都应该是生成结果，不该抢第一屏注意力。</p>
      </div>

      <div className="studio-intake mb-4">
        <div className="studio-intake-head">
          <div>
            <div className="studio-kicker">第 1 步</div>
            <h2>{intakeTitle}</h2>
            <p>先把入口放在最前面。你给数据，我来识别字段；你给指标，我来推导页面结构。</p>
          </div>
          <div className="studio-mode-tabs">
            <button
              className={`studio-mode-tab${mode === 'dataset' ? ' active' : ''}`}
              onClick={() => setMode('dataset')}
            >
              上传数据集
            </button>
            <button
              className={`studio-mode-tab${mode === 'metric' ? ' active' : ''}`}
              onClick={() => setMode('metric')}
            >
              输入指标
            </button>
          </div>
        </div>

        {mode === 'dataset' ? (
          <div className="studio-primary-grid">
            <label className="studio-upload studio-upload-large">
              <input type="file" multiple onChange={handleFileChange} />
              <div className="studio-upload-title">点击上传 CSV / Excel / SQL</div>
              <div className="studio-upload-copy">支持多个文件。先读字段，再自动猜结果指标和看板主题。</div>
              <div className="studio-upload-meta">{files.length > 0 ? `当前样本：${files.join(' / ')}` : '还没有选择文件'}</div>
            </label>

            <div className="studio-side-form">
              <div className="studio-auto-detect">
                <div className="studio-auto-detect-label">系统自动识别</div>
                <div className="studio-auto-detect-value">{metric}</div>
                <div className="studio-auto-detect-copy">业务主题：{business}</div>
              </div>
              <div className="studio-helper-text">你只上传数据集就行。系统会先自动猜结果指标；如果后续猜错，再给你手动改。</div>
              <button className="btn btn-primary studio-generate-btn" onClick={handleGenerate}>直接生成看板</button>
              <button className="btn" onClick={() => { setMetric(''); setBusiness(''); setFiles([]); setDatasetName(''); }}>清空重来</button>
            </div>
          </div>
        ) : (
          <div className="studio-primary-grid">
            <div className="studio-metric-box">
              <div className="form-group">
                <label>北极星指标</label>
                <input value={metric} onChange={e => setMetric(e.target.value)} placeholder="例如：GMV / 签约金额 / 回款金额" />
              </div>
              <div className="form-group">
                <label>一句话业务描述</label>
                <textarea
                  className="studio-textarea"
                  value={business}
                  onChange={e => setBusiness(e.target.value)}
                  placeholder="例如：我想围绕签约金额做一个总览 + 专题看板，给区域负责人看。"
                />
              </div>
            </div>

            <div className="studio-side-form">
              <div className="studio-example-title">可直接输入</div>
              <div className="studio-example-list">
                <span className="studio-chip">签约金额</span>
                <span className="studio-chip">回款金额</span>
                <span className="studio-chip">库存金额</span>
                <span className="studio-chip">线索转化率</span>
              </div>
              <button className="btn btn-primary studio-generate-btn" onClick={handleGenerate}>直接生成看板</button>
              <div className="studio-helper-text">如果只有指标没有数据，我会先生成一版示意看板，再补字段清单。</div>
            </div>
          </div>
        )}

        <div className="studio-intake-footer">
          <div className="studio-switch">
            <button className={`btn ${needPrototype ? 'btn-primary' : ''}`} onClick={() => setNeedPrototype(!needPrototype)}>
              {needPrototype ? '输出 HTML 原型' : '仅输出方案文档'}
            </button>
          </div>
          <div className="studio-result-hint">
            {hasGenerated ? `最近生成：${formatTime(generationAt)} · ${generatedCopy}` : '先给输入，再点击“直接生成看板”。'}
          </div>
        </div>
      </div>

      {hasGenerated && (
        <div className="card studio-result-panel">
          <div className="studio-result-panel-head">
            <div>
              <div className="card-header" style={{ marginBottom: 6 }}>看板预览</div>
              <div className="studio-summary-copy">
                指标：{metric} · 业务主题：{business} · {needPrototype ? '当前为可视化原型预览' : '当前为轻量看板预览'}
              </div>
            </div>
            <div className="studio-chip-row">
              {fields.map(field => (
                <span key={field} className="studio-chip">{field}</span>
              ))}
            </div>
          </div>

          <div className="studio-dashboard-shell">
            <div className="studio-dashboard-head">
              <div>
                <h3>{preview.title}</h3>
                <p>{preview.subtitle}</p>
              </div>
              <div className="studio-chip-row">
                <span className="studio-filter-chip">近 12 个月</span>
                <span className="studio-filter-chip">全部组织</span>
                <span className="studio-filter-chip">{business}</span>
              </div>
            </div>

            <div className="studio-kpi-grid">
              {preview.kpis.map(item => (
                <div key={item.label} className={`studio-preview-kpi ${item.tone}`}>
                  <div className="studio-preview-kpi-label">{item.label}</div>
                  <div className="studio-preview-kpi-value">{item.value}</div>
                  <div className="studio-preview-kpi-sub">{item.sub}</div>
                </div>
              ))}
            </div>

            <div className="studio-dashboard-grid">
              <div className="studio-preview-card">
                <div className="studio-section-label">趋势</div>
                <div className="studio-trend-chart">
                  {preview.trend.map((value, index) => (
                    <div key={`${preview.months[index]}-${value}`} className="studio-trend-col">
                      <div className="studio-trend-bar-wrap">
                        <div className="studio-trend-bar" style={{ height: `${value}%` }} />
                      </div>
                      <span>{preview.months[index]}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="studio-preview-card">
                <div className="studio-section-label">组织排名</div>
                <div className="studio-rank-list">
                  {preview.ranks.map((item, index) => (
                    <div key={item.name} className="studio-rank-row">
                      <div className="studio-rank-main">
                        <strong>{index + 1}. {item.name}</strong>
                        <span>{item.value}万</span>
                      </div>
                      <div className="studio-rank-bar">
                        <span style={{ width: `${72 - index * 12}%` }} />
                      </div>
                      <div className={`studio-rank-delta ${item.delta.startsWith('-') ? 'down' : 'up'}`}>{item.delta}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="studio-dashboard-grid">
              <div className="studio-preview-card">
                <div className="studio-section-label">结构拆解</div>
                <div className="studio-structure-list">
                  {preview.structures.map(item => (
                    <div key={item.name} className="studio-structure-row">
                      <div className="studio-structure-head">
                        <strong>{item.name}</strong>
                        <span>{item.left} / {item.right}</span>
                      </div>
                      <div className="studio-structure-bar">
                        <span style={{ width: `${item.ratio}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="studio-preview-card">
                <div className="studio-section-label">专题入口</div>
                <div className="studio-topic-grid studio-topic-grid-single">
                  {topics.slice(0, 3).map(topic => (
                    <div key={topic.name} className="studio-topic-card">
                      <div className="studio-topic-name">{topic.name}</div>
                      <div className="studio-topic-type">{topic.type}</div>
                      <div className="studio-topic-copy">{topic.summary}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="studio-preview-card">
              <div className="studio-section-label">异常明细</div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>对象</th>
                      <th>负责人</th>
                      <th>异常类型</th>
                      <th>建议动作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map(row => (
                      <tr key={row.name}>
                        <td>{row.name}</td>
                        <td>{row.owner}</td>
                        <td>{row.risk}</td>
                        <td>{row.action}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
