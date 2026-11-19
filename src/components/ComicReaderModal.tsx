import React, { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Languages,
  Loader2,
  Lock,
  X,
} from 'lucide-react';
import { COMIC_PAGES } from '../data/comicPages';
import { resolveAssetUrl } from '../utils/assetUrl';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export const COMIC_PDF_URL = resolveAssetUrl(
  'assets/aistudio/AWANG_KELI_Vol_1_MOJO_COMIX_0580ad21.pdf'
);

interface ComicPdfPageMeta {
  pdfPage: number;
  chipLabel: string;
  chapterLeft: string;
  chapterRight: string;
  title: string;
  englishTitle: string;
  storyPage?: number;
}

const PDF_PAGE_CATALOG: ComicPdfPageMeta[] = [
  {
    pdfPage: 1,
    chipLabel: 'Cover',
    chapterLeft: 'MOJO COMIX · VOL 1',
    chapterRight: 'COVER',
    title: 'Awang Keli: Setelah Tasik Senyap',
    englishTitle: 'Awang Keli: After the Lake Fell Silent (by drmujahid)',
  },
  {
    pdfPage: 2,
    chipLabel: '01',
    chapterLeft: 'AWANG KELI / VOL 1',
    chapterRight: '01 / 08',
    title: 'Sebelum Tasik',
    englishTitle: 'Before the Lake',
    storyPage: 1,
  },
  {
    pdfPage: 3,
    chipLabel: '02',
    chapterLeft: 'AWANG KELI / VOL 1',
    chapterRight: '02 / 08',
    title: 'Seratus Mulut',
    englishTitle: 'A Hundred Mouths',
    storyPage: 2,
  },
  {
    pdfPage: 4,
    chipLabel: '03',
    chapterLeft: 'AWANG KELI / VOL 1',
    chapterRight: '03 / 08',
    title: 'Yang Dibawa Oleh Bangkai',
    englishTitle: 'Carried by the Remains',
    storyPage: 3,
  },
  {
    pdfPage: 5,
    chipLabel: '04',
    chapterLeft: 'AWANG KELI / VOL 1',
    chapterRight: '04 / 08',
    title: 'Tebing',
    englishTitle: 'The Bank',
    storyPage: 4,
  },
  {
    pdfPage: 6,
    chipLabel: '05',
    chapterLeft: 'AWANG KELI / VOL 1',
    chapterRight: '05 / 08',
    title: 'Sepuluh Saat',
    englishTitle: 'Ten Seconds',
    storyPage: 5,
  },
  {
    pdfPage: 7,
    chipLabel: '06',
    chapterLeft: 'AWANG KELI / VOL 1',
    chapterRight: '06 / 08',
    title: 'Pemburu',
    englishTitle: 'The Hunter',
    storyPage: 6,
  },
  {
    pdfPage: 8,
    chipLabel: '07',
    chapterLeft: 'AWANG KELI / VOL 1',
    chapterRight: '07 / 08',
    title: 'Raja Keli',
    englishTitle: 'Keli King',
    storyPage: 7,
  },
  {
    pdfPage: 9,
    chipLabel: '08',
    chapterLeft: 'AWANG KELI / VOL 1',
    chapterRight: '08 / 08',
    title: 'Ke Hulu',
    englishTitle: 'Upstream (Epilogue)',
    storyPage: 8,
  },
  {
    pdfPage: 10,
    chipLabel: 'End',
    chapterLeft: 'MOJO COMIX · EDISI DIGITAL',
    chapterRight: 'KARYA DRMUJAHID',
    title: 'Penutup Vol. 1',
    englishTitle: 'Vol. 1 Closing Plate',
  },
];

let cachedPdfPromise: Promise<pdfjsLib.PDFDocumentProxy> | null = null;

function loadComicPdf(): Promise<pdfjsLib.PDFDocumentProxy> {
  if (!cachedPdfPromise) {
    cachedPdfPromise = pdfjsLib.getDocument({ url: COMIC_PDF_URL }).promise.catch((err) => {
      cachedPdfPromise = null;
      throw err;
    });
  }
  return cachedPdfPromise;
}

interface ComicReaderModalProps {
  open: boolean;
  epilogueUnlocked: boolean;
  initialPage?: number;
  onClose: () => void;
}

export const ComicReaderModal: React.FC<ComicReaderModalProps> = ({
  open,
  epilogueUnlocked,
  initialPage = 1,
  onClose,
}) => {
  const [pageNum, setPageNum] = useState<number>(() =>
    Math.max(1, Math.min(PDF_PAGE_CATALOG.length, initialPage))
  );
  const [totalPages, setTotalPages] = useState<number>(PDF_PAGE_CATALOG.length);
  const [showEnglishNotes, setShowEnglishNotes] = useState(false);
  const [unlockPreview, setUnlockPreview] = useState(false);
  const [loadingPage, setLoadingPage] = useState(false);
  const [pdfFailed, setPdfFailed] = useState(false);
  const [viewportTick, setViewportTick] = useState(0);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open) {
      setPageNum(Math.max(1, Math.min(PDF_PAGE_CATALOG.length, initialPage)));
    }
  }, [open, initialPage]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setPageNum((p) => Math.max(1, p - 1));
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setPageNum((p) => Math.min(totalPages, p + 1));
      }
    };
    const onResize = () => setViewportTick((v) => v + 1);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onResize);
    };
  }, [open, onClose, totalPages]);

  const meta = PDF_PAGE_CATALOG[pageNum - 1] ?? PDF_PAGE_CATALOG[0];
  const isEpilogueLocked = meta.storyPage === 8 && !epilogueUnlocked && !unlockPreview;

  useEffect(() => {
    if (!open || isEpilogueLocked || pdfFailed) return;

    let cancelled = false;
    let activeRenderTask: pdfjsLib.RenderTask | null = null;
    setLoadingPage(true);

    loadComicPdf()
      .then(async (pdf) => {
        if (cancelled) return;
        if (pdf.numPages !== totalPages) {
          setTotalPages(pdf.numPages);
        }
        const safePage = Math.max(1, Math.min(pdf.numPages, pageNum));
        const page = await pdf.getPage(safePage);
        if (cancelled) return;

        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const baseViewport = page.getViewport({ scale: 1 });
        const stageWidth = stageRef.current?.clientWidth
          ? Math.max(260, stageRef.current.clientWidth - 24)
          : Math.min(720, window.innerWidth - 64);
        const targetCssWidth = Math.min(760, stageWidth);
        const cssScale = targetCssWidth / baseViewport.width;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);

        const renderViewport = page.getViewport({ scale: cssScale * dpr });
        canvas.width = Math.floor(renderViewport.width);
        canvas.height = Math.floor(renderViewport.height);
        canvas.style.width = `${Math.floor(baseViewport.width * cssScale)}px`;
        canvas.style.height = `${Math.floor(baseViewport.height * cssScale)}px`;

        activeRenderTask = page.render({
          canvas,
          canvasContext: ctx,
          viewport: renderViewport,
        });
        await activeRenderTask.promise;
        if (!cancelled) {
          setLoadingPage(false);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        if ((err as { name?: string })?.name === 'RenderingCancelledException') return;
        setPdfFailed(true);
        setLoadingPage(false);
      });

    return () => {
      cancelled = true;
      activeRenderTask?.cancel();
    };
  }, [open, pageNum, isEpilogueLocked, pdfFailed, totalPages, viewportTick]);

  if (!open) return null;

  const storyTranslation = meta.storyPage
    ? COMIC_PAGES.find((p) => p.pageNumber === meta.storyPage)
    : undefined;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-3 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Awang Keli Vol. 1: Setelah Tasik Senyap Comic Reader"
    >
      <div className="relative flex flex-col w-full max-w-4xl max-h-[94vh] bg-[#101917] border-2 border-[#c99c4a] rounded-lg shadow-2xl overflow-hidden">
        {/* Top editorial bar */}
        <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3 border-b border-[#3a301e] bg-[#0c1412]">
          <div className="min-w-0">
            <div className="text-[11px] tracking-wider text-[#d9b25f] font-medium truncate">
              {meta.chapterLeft} · {meta.chapterRight}
            </div>
            <h2 className="font-display text-lg sm:text-2xl font-semibold text-[#f3efe6] truncate">
              {showEnglishNotes ? meta.englishTitle : meta.title}
            </h2>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {storyTranslation && (
              <button
                type="button"
                onClick={() => setShowEnglishNotes((v) => !v)}
                className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-xs font-medium rounded border transition-colors whitespace-nowrap ${
                  showEnglishNotes
                    ? 'border-[#c99c4a] bg-[#c99c4a] text-[#0c1412]'
                    : 'border-[#2d423c] bg-[#162320] text-[#d6d3c9] hover:border-[#d4a359] hover:text-white'
                }`}
              >
                <Languages className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">
                  {showEnglishNotes ? 'Hide EN Script' : 'EN Translation'}
                </span>
                <span className="sm:hidden">EN</span>
              </button>
            )}
            <a
              href={COMIC_PDF_URL}
              download="AWANG_KELI_Vol_1_MOJO_COMIX.pdf"
              className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-xs font-medium rounded border border-[#2d423c] bg-[#162320] text-[#d6d3c9] hover:border-[#d4a359] hover:text-white transition-colors whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5 text-[#d4a359]" />
              <span className="hidden sm:inline">PDF</span>
            </a>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close comic reader"
              className="p-1.5 rounded border border-[#2d423c] text-[#9eb0aa] hover:text-white hover:border-[#4b6961] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Comic Page Stage */}
        <div
          ref={stageRef}
          className="flex-1 overflow-y-auto bg-[#0a1110] p-3 sm:p-5 flex flex-col items-center gap-4"
        >
          {isEpilogueLocked ? (
            <div className="my-auto flex flex-col items-center justify-center text-center py-12 px-6 border border-[#3a301e] rounded-lg bg-[#0d1514] max-w-lg">
              <Lock className="w-8 h-8 text-[#d4a359] mb-3" />
              <h3 className="font-display text-2xl text-[#f3efe6] mb-2">
                Page 08 · Ke Hulu (Post-Victory Epilogue)
              </h3>
              <p className="text-sm text-[#a6b5af] mb-6 leading-relaxed">
                Reunite all 100 fragments in a match to become the Keli King and unlock Awang’s final walk upstream—or preview the epilogue page now.
              </p>
              <button
                type="button"
                onClick={() => setUnlockPreview(true)}
                className="px-4 py-2 text-xs font-semibold rounded bg-[#d4a359] text-[#0c1412] hover:bg-[#e5b66c] transition-colors"
              >
                Preview Epilogue Anyway
              </button>
            </div>
          ) : pdfFailed ? (
            <div className="w-full h-[68vh] rounded border border-[#3a301e] overflow-hidden bg-[#0e1615]">
              <iframe
                key={pageNum}
                src={`${COMIC_PDF_URL}#page=${pageNum}&view=FitH`}
                title={`Awang Keli Vol. 1 Page ${pageNum}`}
                className="w-full h-full border-0"
              />
            </div>
          ) : (
            <div className="relative flex items-center justify-center min-h-[320px]">
              <canvas
                ref={canvasRef}
                className="block rounded border border-[#3a301e] shadow-2xl bg-[#161c1a] max-w-full"
              />
              {loadingPage && (
                <div className="absolute inset-0 flex items-center justify-center bg-[#0a1110]/65 rounded">
                  <div className="flex items-center gap-2 px-3 py-2 rounded border border-[#4a3c22] bg-[#101920] text-xs text-[#f3d285]">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Loading page {pageNum}…
                  </div>
                </div>
              )}
            </div>
          )}

          {!isEpilogueLocked && showEnglishNotes && storyTranslation && (
            <div className="w-full max-w-[760px] rounded-lg border border-[#3a301e] bg-[#101920] p-4 space-y-3">
              <div className="text-xs font-semibold tracking-wider text-[#d9b25f]">
                ENGLISH TRANSLATION · PAGE {String(storyTranslation.pageNumber).padStart(2, '0')} ({storyTranslation.englishTitle.toUpperCase()})
              </div>
              {storyTranslation.panels.map((panel, idx) => (
                <div key={panel.id} className="space-y-1 text-xs sm:text-sm text-[#d6d3c9] border-l-2 border-[#5b4724] pl-3">
                  <div className="text-[11px] font-mono-num text-[#8ea0aa]">Panel {idx + 1}</div>
                  <p className="leading-relaxed">{panel.englishText}</p>
                  {panel.dialogue && (
                    <p className="text-[#f3d285] font-medium">
                      {panel.dialogue.speaker}: “{panel.dialogue.english}”
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Page Navigation Footer */}
        <div className="flex items-center justify-between gap-2 sm:gap-4 px-3 sm:px-5 py-3 border-t border-[#3a301e] bg-[#0c1412]">
          <button
            type="button"
            disabled={pageNum <= 1}
            onClick={() => setPageNum((p) => Math.max(1, p - 1))}
            className="flex items-center gap-1 px-2.5 sm:px-3 py-1.5 text-xs font-medium rounded border border-[#2d423c] text-[#d6d3c9] disabled:opacity-40 hover:border-[#d4a359] transition-colors whitespace-nowrap shrink-0"
          >
            <ChevronLeft className="w-4 h-4" />
            <span className="hidden sm:inline">Previous</span>
          </button>

          <div className="flex items-center gap-1 sm:gap-1.5 overflow-x-auto py-0.5">
            {PDF_PAGE_CATALOG.slice(0, totalPages).map((item) => (
              <button
                key={item.pdfPage}
                type="button"
                onClick={() => setPageNum(item.pdfPage)}
                className={`px-2 sm:px-2.5 h-7 text-xs font-mono-num rounded transition-colors shrink-0 ${
                  item.pdfPage === pageNum
                    ? 'bg-[#d4a359] text-[#0c1412] font-semibold'
                    : 'bg-[#162320] text-[#9eb0aa] hover:text-white'
                }`}
              >
                {item.chipLabel}
              </button>
            ))}
          </div>

          <button
            type="button"
            disabled={pageNum >= totalPages}
            onClick={() => setPageNum((p) => Math.min(totalPages, p + 1))}
            className="flex items-center gap-1 px-2.5 sm:px-3 py-1.5 text-xs font-medium rounded border border-[#2d423c] text-[#d6d3c9] disabled:opacity-40 hover:border-[#d4a359] transition-colors whitespace-nowrap shrink-0"
          >
            <span className="hidden sm:inline">Next</span>
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
