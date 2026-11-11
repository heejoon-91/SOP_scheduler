import { useMemo, useState } from 'react';
import { extractCandidates, FLAG_LABELS, TYPE_LABELS, type Candidate, type CandidateFlag, type ObligationType } from './core/extract/candidates';
import { describeRule } from './core/extract/describe';
import { parseHwpx } from './core/hwpx';
import type { Clause, ParsedSopSet, ParsedTable } from './core/model';

type State =
  | { kind: 'idle' }
  | { kind: 'parsing'; file: string }
  | { kind: 'done'; file: string; result: ParsedSopSet; ms: number }
  | { kind: 'error'; file: string; message: string };

export default function App() {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [selected, setSelected] = useState<string | null>(null);

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (!/\.hwpx$/i.test(file.name)) {
      setState({ kind: 'error', file: file.name, message: 'HWPX 파일만 올릴 수 있습니다. 한글에서 "다른 이름으로 저장 → HWPX"로 저장해 주세요.' });
      return;
    }
    setState({ kind: 'parsing', file: file.name });
    const t0 = performance.now();
    try {
      const result = await parseHwpx(await file.arrayBuffer());
      setState({ kind: 'done', file: file.name, result, ms: performance.now() - t0 });
      setSelected(result.sops[0]?.id ?? null);
    } catch (e) {
      setState({ kind: 'error', file: file.name, message: e instanceof Error ? e.message : String(e) });
    }
  }

  return (
    <main>
      <header>
        <h1>SOP 의무 안내 도구</h1>
        <p className="muted">SOP 파일은 이 브라우저 안에서만 처리되며 어디에도 전송되지 않습니다.</p>
      </header>

      <section className="upload">
        <label>
          SOP 파일 올리기 (HWPX)
          <input type="file" accept=".hwpx" onChange={(e) => onFile(e.target.files?.[0])} />
        </label>
        {state.kind === 'parsing' && <p>{state.file} 읽는 중…</p>}
        {state.kind === 'error' && (
          <p className="error">
            {state.file}: {state.message}
          </p>
        )}
      </section>

      {state.kind === 'done' && <Result result={state.result} file={state.file} ms={state.ms} selected={selected} onSelect={setSelected} />}
    </main>
  );
}

function Result({ result, file, ms, selected, onSelect }: { result: ParsedSopSet; file: string; ms: number; selected: string | null; onSelect: (c: string) => void }) {
  const [view, setView] = useState<'clauses' | 'candidates'>('candidates');
  const candidates = useMemo(() => extractCandidates(result), [result]);
  const clauses = result.sops.reduce((n, s) => n + s.clauses.length, 0);
  const sop = result.sops.find((s) => s.id === selected);
  const forms = result.forms.filter((f) => f.sop === sop?.code);
  return (
    <>
      <section className="stats">
        <Stat label="SOP" value={`${result.sops.length} / 목차 ${result.toc.length}`} />
        <Stat label="조항" value={clauses} />
        <Stat label="서식" value={result.forms.length} />
        <Stat label="의무 후보" value={candidates.length} />
        <Stat label="경고" value={result.warnings.length} warn={result.warnings.length > 0} />
        <span className="muted">
          {file} · {Math.round(ms)}ms
        </span>
      </section>

      <div className="tabs">
        <button className={view === 'candidates' ? 'active' : ''} onClick={() => setView('candidates')}>
          의무 후보
        </button>
        <button className={view === 'clauses' ? 'active' : ''} onClick={() => setView('clauses')}>
          조항 원문
        </button>
      </div>

      {view === 'candidates' && <CandidateView result={result} candidates={candidates} />}

      {view === 'clauses' && result.warnings.length > 0 && (
        <section className="warnings">
          <h2>확인이 필요한 곳</h2>
          <ul>
            {result.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </section>
      )}

      {view === 'clauses' && <section className="browser">
        <nav>
          {result.sops.map((s) => (
            <button key={s.id} className={s.id === selected ? 'active' : ''} onClick={() => onSelect(s.id)}>
              <span className="code">{s.id.split('/').pop()}</span> {s.title}
            </button>
          ))}
        </nav>
        {sop && (
          <article>
            <h2>
              {sop.code} {sop.title}
            </h2>
            {forms.length > 0 && <p className="muted">서식: {forms.map((f) => `${f.code.split('/').pop()} ${f.name}`).join(', ')}</p>}
            {sop.clauses.map((c) => (
              <ClauseRow key={c.id} clause={c} />
            ))}
          </article>
        )}
      </section>}
    </>
  );
}

const TYPES = Object.keys(TYPE_LABELS) as ObligationType[];
const FLAGS = Object.keys(FLAG_LABELS) as CandidateFlag[];

function CandidateView({ result, candidates }: { result: ParsedSopSet; candidates: Candidate[] }) {
  const [sop, setSop] = useState<string>('all');
  const [type, setType] = useState<ObligationType | 'all'>('all');
  const [flag, setFlag] = useState<CandidateFlag | 'all'>('all');
  const shown = candidates.filter(
    (c) => (sop === 'all' || c.sop === sop) && (type === 'all' || c.type === type) && (flag === 'all' || c.flags.includes(flag)),
  );
  const countBy = (pred: (c: Candidate) => boolean) => candidates.filter((c) => (sop === 'all' || c.sop === sop) && pred(c)).length;

  return (
    <section className="browser">
      <nav>
        <button className={sop === 'all' ? 'active' : ''} onClick={() => setSop('all')}>
          전체 SOP ({candidates.length})
        </button>
        {result.sops.map((s) => (
          <button key={s.id} className={s.id === sop ? 'active' : ''} onClick={() => setSop(s.id)}>
            <span className="code">{s.id.split('/').pop()}</span> {s.title} ({candidates.filter((c) => c.sop === s.id).length})
          </button>
        ))}
      </nav>
      <article>
        <p className="muted">
          규칙(키워드·정규식)으로 뽑은 초안입니다. 빠진 의무가 있을 수 있고, 의무가 아닌 문장도 섞여 있습니다. 근거 조항 원문과 대조해 검토하세요.
        </p>
        <div className="filters">
          <span className="muted">유형</span>
          <Chip active={type === 'all'} onClick={() => setType('all')}>
            전체 {countBy(() => true)}
          </Chip>
          {TYPES.map((t) => (
            <Chip key={t} active={type === t} onClick={() => setType(t)}>
              {TYPE_LABELS[t]} {countBy((c) => c.type === t)}
            </Chip>
          ))}
        </div>
        <div className="filters">
          <span className="muted">플래그</span>
          <Chip active={flag === 'all'} onClick={() => setFlag('all')}>
            전체
          </Chip>
          {FLAGS.map((f) => (
            <Chip key={f} active={flag === f} onClick={() => setFlag(f)}>
              {FLAG_LABELS[f]} {countBy((c) => c.flags.includes(f))}
            </Chip>
          ))}
        </div>
        <p className="shown-count">
          {sop === 'all' ? '전체 SOP' : sop.split('/').pop()} · {type === 'all' ? '모든 유형' : TYPE_LABELS[type]}
          {flag !== 'all' ? ` · ${FLAG_LABELS[flag]}` : ''} — <strong>{shown.length}건</strong> 표시
        </p>
        {shown.map((c) => (
          <CandidateCard key={c.id} c={c} />
        ))}
        {!shown.length && <p className="muted">조건에 맞는 후보가 없습니다.</p>}
      </article>
    </section>
  );
}

function CandidateCard({ c }: { c: Candidate }) {
  return (
    <div className={`card type-${c.type}`}>
      <div className="card-head">
        <span className={`badge type-${c.type}`}>{TYPE_LABELS[c.type]}</span>
        <span className="path">
          {c.sop.split('/').pop()} {c.path}
          {c.source === 'table_row' ? ` 표 ${c.rowIndex}행` : ''}
        </span>
        {c.strength === 'medium' && <span className="muted">약한 후보</span>}
        {c.flags.map((f) => (
          <span key={f} className="flag">
            {FLAG_LABELS[f]}
          </span>
        ))}
      </div>
      {c.context.length > 0 && <div className="muted">{c.context.join(' › ')}</div>}
      <div className="card-text">{c.text}</div>
      <dl>
        {c.trigger && (
          <>
            <dt>조건</dt>
            <dd>{c.trigger}</dd>
          </>
        )}
        <dt>기한</dt>
        <dd>{c.deadlines.length ? c.deadlines.map((d) => `${d.phrase} → ${describeRule(d.rule)}`).join(' · ') : '—'}</dd>
        <dt>담당</dt>
        <dd>{c.actor ?? '—'}</dd>
        {c.recipients.length > 0 && (
          <>
            <dt>보고처</dt>
            <dd>{c.recipients.join(', ')}</dd>
          </>
        )}
        <dt>서식</dt>
        <dd>
          {c.forms.length ? c.forms.map((f) => f.split('/').pop()).join(', ') : '—'}
          {c.inheritedForms.length > 0 && <span className="muted"> (상위 조항: {c.inheritedForms.map((f) => f.split('/').pop()).join(', ')})</span>}
        </dd>
        <dt>유형 근거</dt>
        <dd className="muted">{c.typeReason}</dd>
      </dl>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button className={`chip ${active ? 'active' : ''}`} onClick={onClick}>
      {children}
    </button>
  );
}

function ClauseRow({ clause }: { clause: Clause }) {
  const depth = clause.level === 0 ? (clause.path.match(/[.)]/g)?.length ?? 0) : clause.level - 1;
  return (
    <div className={`clause ${clause.level === 1 ? 'top' : ''}`} style={{ marginLeft: `${depth * 1.25}rem` }}>
      <span className="path">{clause.path}</span>
      <span>{clause.text}</span>
      {[...clause.formRefs, ...clause.sopRefs].map((r) => (
        <span key={r} className="ref">
          {r.split('/').slice(1).join('/')}
        </span>
      ))}
      {clause.tables.map((t, i) => (
        <Table key={i} table={t} />
      ))}
    </div>
  );
}

function Table({ table }: { table: ParsedTable }) {
  return (
    <table>
      <tbody>
        {table.rows.map((row, r) => (
          <tr key={r}>
            {row.map((cell, c) => (
              <td key={c}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Stat({ label, value, warn }: { label: string; value: string | number; warn?: boolean }) {
  return (
    <div className={`stat ${warn ? 'warn' : ''}`}>
      <div className="muted">{label}</div>
      <div className="value">{value}</div>
    </div>
  );
}
