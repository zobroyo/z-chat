import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

export const Route = createFileRoute("/scripture")({
  head: () => ({ meta: [{ title: "Scripture — ZChat" }] }),
  component: ScripturePage,
});

const BASE = "/media/scripture";

interface IndexWork {
  key: string;
  tradition: string;
  label: string;
  icon: string;
}
interface VerseBook {
  name: string;
  chapters: string[][];
}
interface VerseWork {
  kind: "verse";
  work: string;
  books: VerseBook[];
}
interface Ayah {
  n: number;
  ar: string;
  en: string;
}
interface Surah {
  number: number;
  name: string;
  translit: string;
  translation: string;
  ayahs: Ayah[];
}
interface QuranWork {
  kind: "quran";
  work: string;
  surahs: Surah[];
}
interface ProseChapter {
  title: string;
  paragraphs: string[];
}
interface ProseWork {
  kind: "prose";
  work: string;
  chapters: ProseChapter[];
}
type Work = VerseWork | QuranWork | ProseWork;

function ScripturePage() {
  const [works, setWorks] = useState<IndexWork[] | null>(null);
  const [active, setActive] = useState("christianity");
  const [data, setData] = useState<Work | null>(null);
  const [loading, setLoading] = useState(true);
  const [unit, setUnit] = useState(0);
  const [chap, setChap] = useState(0);

  useEffect(() => {
    fetch(`${BASE}/index.json`)
      .then((r) => r.json())
      .then((j: { works: IndexWork[] }) => setWorks(j.works))
      .catch(() => setWorks([]));
  }, []);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setData(null);
    setUnit(0);
    setChap(0);
    fetch(`${BASE}/${active}.json`)
      .then((r) => r.json())
      .then((j: Work) => {
        if (live) setData(j);
      })
      .catch(() => {
        if (live) setData(null);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [active]);

  const activeWork = useMemo(() => works?.find((w) => w.key === active), [works, active]);

  return (
    <main className="standalone-scroll-page ios-safe-top ios-safe-bottom mx-auto min-h-screen w-full max-w-3xl px-5 py-8">
      <div className="mb-6 flex items-center gap-3">
        <Link
          to="/services"
          aria-label="Back to services"
          className="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold">Scripture</h1>
          <p className="text-xs text-muted-foreground">
            {activeWork ? activeWork.label : "Sacred texts, read in place."}
          </p>
        </div>
      </div>

      <div className="mb-5 flex flex-wrap gap-2">
        {(works ?? []).map((w) => (
          <button
            key={w.key}
            type="button"
            onClick={() => setActive(w.key)}
            className={
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors " +
              (w.key === active
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-surface-1 text-muted-foreground hover:text-foreground")
            }
          >
            <span aria-hidden>{w.icon}</span>
            {w.tradition}
          </button>
        ))}
      </div>

      {loading && (
        <div className="flex items-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading…
        </div>
      )}

      {!loading && !data && (
        <p className="py-16 text-sm text-muted-foreground">
          Couldn't load this text right now. Try again in a moment.
        </p>
      )}

      {!loading && data && (
        <div className="space-y-5">
          <p className="text-sm font-semibold text-foreground">{data.work}</p>

          {data.kind === "verse" && (
            <VerseReader
              work={data}
              unit={unit}
              chap={chap}
              setUnit={(u) => {
                setUnit(u);
                setChap(0);
              }}
              setChap={setChap}
            />
          )}

          {data.kind === "quran" && <QuranReader work={data} unit={unit} setUnit={setUnit} />}

          {data.kind === "prose" && <ProseReader work={data} unit={unit} setUnit={setUnit} />}
        </div>
      )}
    </main>
  );
}

function Selector({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  options: string[];
}) {
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full rounded-md border border-border bg-surface-1 px-2 py-1.5 text-sm text-foreground"
      >
        {options.map((o, i) => (
          <option key={i} value={i}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

function VerseReader({
  work,
  unit,
  chap,
  setUnit,
  setChap,
}: {
  work: VerseWork;
  unit: number;
  chap: number;
  setUnit: (u: number) => void;
  setChap: (c: number) => void;
}) {
  const book = work.books[unit];
  if (!book) return null;
  const chapters = book.chapters;
  const verses = chapters[chap] ?? [];
  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Selector label="Book" value={unit} onChange={setUnit} options={work.books.map((b) => b.name)} />
        <Selector
          label="Chapter"
          value={chap}
          onChange={setChap}
          options={chapters.map((_, i) => String(i + 1))}
        />
      </div>
      <article className="surface-panel rounded-2xl p-5">
        <p className="mb-3 text-xs font-semibold text-muted-foreground">
          {book.name} {chap + 1}
        </p>
        <ol className="space-y-2">
          {verses.map((v, i) => (
            <li key={i} className="flex gap-2 text-sm leading-6 text-foreground">
              <span className="w-6 shrink-0 text-right text-xs text-muted-foreground">{i + 1}</span>
              <span>{v}</span>
            </li>
          ))}
        </ol>
      </article>
    </>
  );
}

function QuranReader({
  work,
  unit,
  setUnit,
}: {
  work: QuranWork;
  unit: number;
  setUnit: (u: number) => void;
}) {
  const surah = work.surahs[unit];
  if (!surah) return null;
  return (
    <>
      <Selector
        label="Surah"
        value={unit}
        onChange={setUnit}
        options={work.surahs.map((s) => `${s.number}. ${s.translit} — ${s.translation}`)}
      />
      <article className="surface-panel rounded-2xl p-5">
        <p className="mb-3 text-xs font-semibold text-muted-foreground">
          Surah {surah.number} · {surah.name} ({surah.translit})
        </p>
        <ol className="space-y-4">
          {surah.ayahs.map((a) => (
            <li key={a.n} className="space-y-1">
              <p dir="rtl" className="text-right text-lg leading-9 text-foreground">
                {a.ar}
              </p>
              <p className="flex gap-2 text-sm leading-6 text-muted-foreground">
                <span className="w-6 shrink-0 text-right text-xs">{a.n}</span>
                <span>{a.en}</span>
              </p>
            </li>
          ))}
        </ol>
      </article>
    </>
  );
}

function ProseReader({
  work,
  unit,
  setUnit,
}: {
  work: ProseWork;
  unit: number;
  setUnit: (u: number) => void;
}) {
  const chapter = work.chapters[unit];
  if (!chapter) return null;
  return (
    <>
      <Selector
        label="Chapter"
        value={unit}
        onChange={setUnit}
        options={work.chapters.map((c) => c.title)}
      />
      <article className="surface-panel rounded-2xl p-5">
        <p className="mb-3 text-xs font-semibold text-muted-foreground">{chapter.title}</p>
        <div className="space-y-3">
          {chapter.paragraphs.map((p, i) => (
            <p key={i} className="text-sm leading-6 whitespace-pre-line text-foreground">
              {p}
            </p>
          ))}
        </div>
      </article>
    </>
  );
}
