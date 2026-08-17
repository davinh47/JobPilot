"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, Download, FileText, LoaderCircle, RefreshCw } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import type { ResumeTemplate } from "@/lib/resume-export";

type PreviewChoice = ResumeTemplate | "original";
type TemplateOption = { id: PreviewChoice; zh: string; en: string; descriptionZh: string; descriptionEn: string };
type PreviewResult = { key: string; data: Uint8Array | null; failed: boolean };
type CanvasRenderResult = { key: string; failed: boolean };

const generatedTemplates: TemplateOption[] = [
  { id: "classic", zh: "经典", en: "Classic", descriptionZh: "衬线字体、清晰分隔线和传统层级。", descriptionEn: "Serif typography, clear rules, and traditional hierarchy." },
  { id: "modern", zh: "现代", en: "Modern", descriptionZh: "左对齐、强调色章节标记和右对齐日期。", descriptionEn: "Left aligned with accent markers and right-aligned dates." },
  { id: "compact", zh: "紧凑", en: "Compact", descriptionZh: "更高信息密度，保留项目与经历层级。", descriptionEn: "Higher information density without flattening entry hierarchy." },
];

function PdfCanvasPreview({ data, requestKey, locale }: { data: Uint8Array; requestKey: string; locale: Locale }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [renderResult, setRenderResult] = useState<CanvasRenderResult | null>(null);
  const currentResult = renderResult?.key === requestKey ? renderResult : null;
  const text = (zh: string, en: string) => locale === "zh" ? zh : en;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    let resizeObserver: ResizeObserver | undefined;
    let lastWidth = 0;
    let renderGeneration = 0;
    const activeRenderTasks: Array<{ cancel: () => void }> = [];
    let pdfDocument: import("pdfjs-dist").PDFDocumentProxy | undefined;

    void import("pdfjs-dist").then(async (pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      pdfDocument = await pdfjs.getDocument({ data: data.slice() }).promise;

      const renderPages = async () => {
        const width = Math.floor(container.clientWidth);
        if (cancelled || width <= 0 || width === lastWidth) return;
        lastWidth = width;
        renderGeneration += 1;
        const generation = renderGeneration;
        activeRenderTasks.splice(0).forEach((task) => task.cancel());
        container.replaceChildren();

        const targetWidth = Math.max(280, Math.min(width - 32, 860));
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
        for (let pageNumber = 1; pageNumber <= pdfDocument!.numPages; pageNumber += 1) {
          if (cancelled || generation !== renderGeneration) return;
          const page = await pdfDocument!.getPage(pageNumber);
          const baseViewport = page.getViewport({ scale: 1 });
          const cssScale = targetWidth / baseViewport.width;
          const viewport = page.getViewport({ scale: cssScale * pixelRatio });
          const sheet = document.createElement("div");
          const canvas = document.createElement("canvas");
          sheet.className = "resume-pdf-page";
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.style.width = `${Math.floor(viewport.width / pixelRatio)}px`;
          canvas.style.height = `${Math.floor(viewport.height / pixelRatio)}px`;
          sheet.append(canvas);
          container.append(sheet);
          const renderTask = page.render({ canvas, viewport });
          activeRenderTasks.push(renderTask);
          try {
            await renderTask.promise;
          } catch (error) {
            if (cancelled || generation !== renderGeneration) return;
            throw error;
          }
        }

        if (!cancelled && generation === renderGeneration) setRenderResult({ key: requestKey, failed: false });
      };

      await renderPages();
      resizeObserver = new ResizeObserver(() => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => void renderPages(), 120);
      });
      resizeObserver.observe(container);
      if (cancelled) resizeObserver.disconnect();
    }).catch(() => {
      if (!cancelled) setRenderResult({ key: requestKey, failed: true });
    });

    return () => {
      cancelled = true;
      clearTimeout(resizeTimer);
      resizeObserver?.disconnect();
      activeRenderTasks.splice(0).forEach((task) => task.cancel());
      void pdfDocument?.destroy();
      container.replaceChildren();
    };
  }, [data, requestKey]);

  return <div className="resume-pdf-canvas-shell">
    {!currentResult ? <div className="resume-preview-state" role="status"><LoaderCircle className="spin" size={26} /><strong>{text("正在绘制页面", "Rendering pages")}</strong></div> : null}
    {currentResult?.failed ? <div className="resume-preview-state resume-preview-error" role="alert"><AlertCircle size={28} /><strong>{text("预览绘制失败", "Preview rendering failed")}</strong><span>{text("PDF 已生成，但浏览器暂时无法绘制。你仍可下载 PDF 或 DOCX。", "The PDF was generated, but the browser could not render it. You can still download the PDF or DOCX.")}</span></div> : null}
    <div ref={containerRef} className="resume-pdf-canvas-view" aria-busy={!currentResult} />
  </div>;
}

export function ResumePreview({ locale, resumeId, hasOriginal, originalType }: { locale: Locale; resumeId: string; hasOriginal: boolean; originalType: string }) {
  const originalPreviewable = hasOriginal && originalType === "pdf";
  const options: TemplateOption[] = hasOriginal ? [{ id: "original", zh: "原版", en: "Original", descriptionZh: originalPreviewable ? "直接显示上传的 PDF，版式完全不变。" : "原件会保持不变；此文件类型请下载后查看。", descriptionEn: originalPreviewable ? "Displays the uploaded PDF directly with no layout changes." : "The source stays unchanged; download this file type to view it." }, ...generatedTemplates] : generatedTemplates;
  const [template, setTemplate] = useState<PreviewChoice>(originalPreviewable ? "original" : "modern");
  const selected = options.find((item) => item.id === template) ?? options[0];
  const text = (zh: string, en: string) => locale === "zh" ? zh : en;
  const original = template === "original";
  const sourceUrl = original
    ? `/resumes/${resumeId}/source?preview=1`
    : `/resumes/${resumeId}/export?format=pdf&template=${template}&preview=1`;
  const shouldLoadPreview = !original || originalPreviewable;
  const [retryKey, setRetryKey] = useState(0);
  const requestKey = `${sourceUrl}:${retryKey}`;
  const [previewResult, setPreviewResult] = useState<PreviewResult | null>(null);
  const currentResult = previewResult?.key === requestKey ? previewResult : null;
  const previewLoading = shouldLoadPreview && currentResult === null;
  const previewError = currentResult?.failed ?? false;
  const previewData = currentResult?.data ?? null;

  useEffect(() => {
    if (!shouldLoadPreview) return;

    const controller = new AbortController();
    void fetch(sourceUrl, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        if (!response.headers.get("content-type")?.includes("application/pdf")) throw new Error("Unexpected response");
        setPreviewResult({ key: requestKey, data: new Uint8Array(await response.arrayBuffer()), failed: false });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setPreviewResult({ key: requestKey, data: null, failed: true });
      });

    return () => {
      controller.abort();
    };
  }, [requestKey, shouldLoadPreview, sourceUrl]);

  return (
    <div className="resume-preview-workspace">
      <div className="resume-preview-toolbar">
        <div className="segmented-control" aria-label={text("简历风格", "Resume style")}>
          {options.map((item) => <button className={template === item.id ? "active" : ""} key={item.id} onClick={() => setTemplate(item.id)} type="button">{locale === "zh" ? item.zh : item.en}</button>)}
        </div>
        <div className="preview-template-note"><FileText size={16} /><span><strong>{locale === "zh" ? selected.zh : selected.en}</strong><small>{locale === "zh" ? selected.descriptionZh : selected.descriptionEn}</small></span></div>
        <div className="resume-preview-downloads">
          {original ? <a className="button button-primary" href={`/resumes/${resumeId}/source`}><Download size={16} />{text("下载原件", "Download original")}</a> : <>
            <a className="button button-secondary" href={`/resumes/${resumeId}/export?format=docx&template=${template}`}><FileText size={16} />{text("下载 DOCX", "Download DOCX")}</a>
            <a className="button button-primary" href={`/resumes/${resumeId}/export?format=pdf&template=${template}`}><Download size={16} />{text("下载 PDF", "Download PDF")}</a>
          </>}
        </div>
      </div>
      {original && !originalPreviewable ? <div className="resume-source-unavailable"><FileText size={28} /><h2>{text("原件已安全保留", "Original file preserved")}</h2><p>{text("DOCX 和 TXT 无法在浏览器中保证与原应用完全一致，请下载原件查看。", "DOCX and TXT cannot be rendered identically in the browser. Download the source to view it in its original application.")}</p><a className="button button-primary" href={`/resumes/${resumeId}/source`}><Download size={16} />{text("下载原件", "Download original")}</a></div> : <div className="resume-pdf-stage">
        {previewLoading ? <div className="resume-preview-state" role="status"><LoaderCircle className="spin" size={26} /><strong>{text("正在生成预览", "Generating preview")}</strong><span>{text("较长的简历可能需要几秒钟。", "Longer resumes can take a few seconds.")}</span></div> : null}
        {!previewLoading && previewError ? <div className="resume-preview-state resume-preview-error" role="alert"><AlertCircle size={28} /><strong>{text("预览生成失败", "Preview unavailable")}</strong><span>{text("暂时无法生成这个预览。请重试；若仍失败，可先下载 DOCX。", "This preview could not be generated. Retry, or download the DOCX if the issue continues.")}</span><button className="button button-secondary" type="button" onClick={() => setRetryKey((value) => value + 1)}><RefreshCw size={16} />{text("重新加载", "Retry")}</button></div> : null}
        {!previewLoading && !previewError && previewData ? <PdfCanvasPreview key={`${template}-${retryKey}`} data={previewData} requestKey={requestKey} locale={locale} /> : null}
      </div>}
    </div>
  );
}
