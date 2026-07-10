import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlignmentType,
  Document as DocxDocument,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
  UnderlineType,
  type IParagraphOptions,
  type IRunOptions,
} from "docx";
import { api } from "../api";
import {
  clearRealtimeCursor,
  ensureRealtimeDocument,
  firebaseRealtimeReady,
  saveRealtimeCursor,
  saveRealtimeDocument,
  subscribeRealtimeDocument,
  type RealtimeCursor,
} from "./firebaseRealtime";
import { formatDate, projectFromResponse } from "./projectUtils";
import type { Project, ProjectPresence, UserMini } from "./types";

type Props = {
  project: Project;
  currentUser: UserMini | null;
  editors: ProjectPresence[];
  onSaved: (project: Project) => void;
  onActivity: (area: string, action: string) => void;
};

type CursorBubble = {
  user: UserMini;
  left: number;
  top: number;
};

const maxDocumentLength = 50_000;

const fontSizes = [
  { label: "12", value: "2" },
  { label: "16", value: "3" },
  { label: "20", value: "4" },
  { label: "28", value: "5" },
  { label: "36", value: "6" },
];

function projectDocument(project: Project) {
  return project.document || {
    content: "",
    updatedBy: null,
    updatedAt: null,
    version: 0,
  };
}

function plainTextFromHtml(html: string) {
  const container = window.document.createElement("div");
  container.innerHTML = html;
  return container.textContent || "";
}

function sanitizeEditorHtml(html: string) {
  const template = window.document.createElement("template");
  template.innerHTML = html.slice(0, maxDocumentLength * 4);
  template.content.querySelectorAll("script, iframe, object, embed, link, meta").forEach((node) => node.remove());
  template.content.querySelectorAll("*").forEach((node) => {
    for (const attribute of [...node.attributes]) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim().toLowerCase();
      if (name.startsWith("on") || value.startsWith("javascript:")) {
        node.removeAttribute(attribute.name);
      }
    }
  });

  return template.innerHTML;
}

function fileName(value: string, extension: string) {
  const safeName = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

  return `${safeName || "documento"}.${extension}`;
}

function exportHtml(title: string, content: string) {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
    <style>
      body { font-family: Arial, sans-serif; color: #172033; line-height: 1.55; }
      h1, h2, h3 { color: #172033; }
      table { border-collapse: collapse; }
      p { margin: 0 0 12px; }
    </style>
  </head>
  <body>
    <h1>${title}</h1>
    ${content || "<p></p>"}
  </body>
</html>`;
}

function colorToHex(value: string) {
  const color = value.trim();
  if (!color) return undefined;
  if (color.startsWith("#")) return color.replace("#", "").toUpperCase();

  const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (!match) return undefined;

  return [match[1], match[2], match[3]]
    .map((part) => Number(part).toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

function fontSizeToHalfPoints(value: string) {
  const numeric = Number.parseFloat(value);
  if (!Number.isFinite(numeric)) return undefined;

  if (value.endsWith("px")) return Math.round(numeric * 1.5);
  if (value.endsWith("pt")) return Math.round(numeric * 2);
  return undefined;
}

function fontTagSizeToHalfPoints(value: string | null) {
  const map: Record<string, number> = {
    "1": 16,
    "2": 20,
    "3": 24,
    "4": 28,
    "5": 36,
    "6": 48,
    "7": 64,
  };

  return value ? map[value] : undefined;
}

function runsFromNode(node: Node, inherited: IRunOptions = {}): TextRun[] {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent || "";
    return text ? [new TextRun({ ...inherited, text })] : [];
  }

  if (!(node instanceof HTMLElement)) return [];
  if (node.tagName === "BR") return [new TextRun({ ...inherited, break: 1 })];

  let next: IRunOptions = { ...inherited };
  const tag = node.tagName.toLowerCase();
  if (tag === "b" || tag === "strong") next = { ...next, bold: true };
  if (tag === "i" || tag === "em") next = { ...next, italics: true };
  if (tag === "u") next = { ...next, underline: { type: UnderlineType.SINGLE } };

  const color = colorToHex(node.style.color);
  const size = fontSizeToHalfPoints(node.style.fontSize) || fontTagSizeToHalfPoints(node.getAttribute("size"));
  const face = node.style.fontFamily || node.getAttribute("face");
  if (color) next = { ...next, color };
  if (size) next = { ...next, size };
  if (face) next = { ...next, font: face.replace(/["']/g, "") };

  return [...node.childNodes].flatMap((child) => runsFromNode(child, next));
}

function paragraphAlignment(element?: Element) {
  const alignment = element instanceof HTMLElement ? element.style.textAlign : "";
  if (alignment === "center") return AlignmentType.CENTER;
  if (alignment === "right") return AlignmentType.RIGHT;
  if (alignment === "justify") return AlignmentType.JUSTIFIED;
  return undefined;
}

function paragraphFromNodes(nodes: Node[], sourceElement?: Element) {
  const runs = nodes.flatMap((node) => runsFromNode(node));
  const tag = sourceElement?.tagName.toLowerCase();
  const options: IParagraphOptions = {
    children: runs.length ? runs : [new TextRun("")],
    alignment: paragraphAlignment(sourceElement),
    heading:
      tag === "h1"
        ? HeadingLevel.HEADING_1
        : tag === "h2"
          ? HeadingLevel.HEADING_2
          : tag === "h3"
            ? HeadingLevel.HEADING_3
            : undefined,
    bullet: tag === "li" ? { level: 0 } : undefined,
  };

  return new Paragraph(options);
}

function docxParagraphsFromHtml(html: string) {
  const container = window.document.createElement("div");
  container.innerHTML = sanitizeEditorHtml(html);
  const blockTags = new Set(["P", "DIV", "H1", "H2", "H3", "LI", "BLOCKQUOTE"]);
  const paragraphs: Paragraph[] = [];
  const inlineNodes: Node[] = [];

  const flushInline = () => {
    if (!inlineNodes.length) return;
    paragraphs.push(paragraphFromNodes([...inlineNodes]));
    inlineNodes.length = 0;
  };

  const pushBlock = (element: Element) => {
    flushInline();
    paragraphs.push(paragraphFromNodes([...element.childNodes], element));
  };

  for (const child of [...container.childNodes]) {
    if (child instanceof HTMLElement && (child.tagName === "UL" || child.tagName === "OL")) {
      flushInline();
      child.querySelectorAll(":scope > li").forEach(pushBlock);
    } else if (child instanceof HTMLElement && blockTags.has(child.tagName)) {
      pushBlock(child);
    } else if (child.textContent?.trim() || child instanceof HTMLElement) {
      inlineNodes.push(child);
    }
  }

  flushInline();
  return paragraphs.length ? paragraphs : [new Paragraph("")];
}

function getCaretOffset(root: HTMLElement) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return 0;

  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer)) return 0;

  const prefix = range.cloneRange();
  prefix.selectNodeContents(root);
  prefix.setEnd(range.startContainer, range.startOffset);
  return prefix.toString().length;
}

function rangeFromOffset(root: HTMLElement, offset: number) {
  const walker = window.document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let remaining = Math.max(0, offset);
  let textNode = walker.nextNode();

  while (textNode) {
    const textLength = textNode.textContent?.length || 0;
    if (remaining <= textLength) {
      const range = window.document.createRange();
      range.setStart(textNode, remaining);
      range.collapse(true);
      return range;
    }

    remaining -= textLength;
    textNode = walker.nextNode();
  }

  const fallback = window.document.createRange();
  fallback.selectNodeContents(root);
  fallback.collapse(false);
  return fallback;
}

function cursorPoint(root: HTMLElement, surface: HTMLElement, offset: number) {
  const range = rangeFromOffset(root, offset);
  let rect = range.getBoundingClientRect();

  if (!rect.width && !rect.height) {
    const marker = window.document.createElement("span");
    marker.textContent = "\u200b";
    range.insertNode(marker);
    rect = marker.getBoundingClientRect();
    marker.remove();
  }

  const surfaceRect = surface.getBoundingClientRect();
  return {
    left: Math.max(10, rect.left - surfaceRect.left + surface.scrollLeft),
    top: Math.max(8, rect.top - surfaceRect.top + surface.scrollTop - 38),
  };
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = window.document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

export default function ProjectDocumentEditor({ project, currentUser, editors, onSaved, onActivity }: Props) {
  const documentInfo = projectDocument(project);
  const [contentHtml, setContentHtml] = useState(documentInfo.content);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [remoteCursors, setRemoteCursors] = useState<RealtimeCursor[]>([]);
  const [cursorBubbles, setCursorBubbles] = useState<CursorBubble[]>([]);
  const [realtimeActive, setRealtimeActive] = useState(false);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const wordInputRef = useRef<HTMLInputElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const projectIdRef = useRef(project._id);
  const latestHtmlRef = useRef(documentInfo.content);
  const lastVersionRef = useRef(documentInfo.version);
  const backendSaveTimerRef = useRef<number | undefined>(undefined);
  const realtimeSaveTimerRef = useRef<number | undefined>(undefined);
  const cursorTimerRef = useRef<number | undefined>(undefined);
  const savingRef = useRef(false);
  const dirtyRef = useRef(false);
  const focusedRef = useRef(false);
  const queuedSaveRef = useRef<string | null>(null);
  const realtimeEnabled = firebaseRealtimeReady();

  const fallbackEditors = useMemo(() => {
    const unique = new Map<string, UserMini>();

    for (const editor of editors) {
      if (editor.user?.id && editor.user.id !== currentUser?.id) {
        unique.set(editor.user.id, editor.user);
      }
    }

    return [...unique.values()];
  }, [currentUser?.id, editors]);

  const canEdit = project.myStatus === "active";
  const plainLength = plainTextFromHtml(contentHtml).length;
  const saveState = saving ? "Guardando" : dirty ? "Pendiente" : "Guardado";
  const saveStateClass = saving ? "saving" : dirty ? "pending" : "saved";
  const lastUpdate = documentInfo.updatedAt
    ? `${documentInfo.updatedBy?.name || "Usuario"} - ${formatDate(documentInfo.updatedAt)}`
    : "Sin ediciones";

  function applyHtml(nextHtml: string) {
    const safeHtml = sanitizeEditorHtml(nextHtml);
    latestHtmlRef.current = safeHtml;
    setContentHtml(safeHtml);

    if (editorRef.current && editorRef.current.innerHTML !== safeHtml) {
      editorRef.current.innerHTML = safeHtml;
    }
  }

  async function saveDocument(projectId = project._id, content = latestHtmlRef.current) {
    if (!canEdit) return;

    if (savingRef.current) {
      queuedSaveRef.current = content;
      return;
    }

    savingRef.current = true;
    setSaving(true);
    setMessage("");

    try {
      const { data } = await api.patch(`/projects/${projectId}/document`, { content });
      const nextProject = projectFromResponse(data.project);
      onSaved(nextProject);

      if (projectIdRef.current === projectId && latestHtmlRef.current === content) {
        dirtyRef.current = false;
        setDirty(false);
        setMessage("Guardado");
        lastVersionRef.current = projectDocument(nextProject).version;
      }
    } catch {
      dirtyRef.current = true;
      setDirty(true);
      setMessage("No se pudo guardar en el servidor.");
    } finally {
      savingRef.current = false;
      setSaving(false);

      const queuedContent = queuedSaveRef.current;
      queuedSaveRef.current = null;
      if (queuedContent !== null && queuedContent !== content && projectIdRef.current === projectId) {
        window.setTimeout(() => void saveDocument(projectId, queuedContent), 0);
      }
    }
  }

  function scheduleBackendSave(nextContent: string) {
    window.clearTimeout(backendSaveTimerRef.current);
    backendSaveTimerRef.current = window.setTimeout(() => {
      void saveDocument(project._id, nextContent);
    }, 1100);
  }

  function scheduleRealtimeSave(nextContent: string) {
    if (!realtimeEnabled) return;

    window.clearTimeout(realtimeSaveTimerRef.current);
    realtimeSaveTimerRef.current = window.setTimeout(() => {
      void saveRealtimeDocument(project._id, nextContent, currentUser).catch(() => {
        setRealtimeActive(false);
      });
    }, 180);
  }

  function publishCursor(delay = 120) {
    if (!realtimeEnabled || !editorRef.current) return;

    window.clearTimeout(cursorTimerRef.current);
    cursorTimerRef.current = window.setTimeout(() => {
      if (!editorRef.current) return;

      const cursorOffset = getCaretOffset(editorRef.current);
      void saveRealtimeCursor(project._id, currentUser, cursorOffset).catch(() => {});
    }, delay);
  }

  function handleInput() {
    if (!editorRef.current) return;

    const nextContent = sanitizeEditorHtml(editorRef.current.innerHTML);
    latestHtmlRef.current = nextContent;
    dirtyRef.current = true;
    setContentHtml(nextContent);
    setDirty(true);
    setMessage("");
    onActivity("documento", "editando el documento");
    scheduleRealtimeSave(nextContent);
    scheduleBackendSave(nextContent);
    publishCursor(0);
  }

  function commitImportedContent(nextContent: string) {
    const safeContent = sanitizeEditorHtml(nextContent);
    latestHtmlRef.current = safeContent;
    dirtyRef.current = true;
    setContentHtml(safeContent);
    setDirty(true);
    setMessage("Archivo importado. Guardando cambios...");
    if (editorRef.current) editorRef.current.innerHTML = safeContent;
    onActivity("documento", "importando un archivo de Word");
    scheduleRealtimeSave(safeContent);
    scheduleBackendSave(safeContent);
  }

  async function importWordFile(file?: File) {
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".docx")) {
      setMessage("Por ahora importa archivos .docx de Word.");
      return;
    }

    try {
      setMessage("Importando Word...");
      const arrayBuffer = await file.arrayBuffer();
      const mammoth = await import("mammoth");
      const result = await mammoth.convertToHtml({ arrayBuffer });
      commitImportedContent(result.value);
    } catch {
      setMessage("No se pudo importar el archivo de Word.");
    } finally {
      if (wordInputRef.current) wordInputRef.current.value = "";
    }
  }

  function format(command: string, value?: string) {
    if (!canEdit) return;

    editorRef.current?.focus();
    window.document.execCommand(command, false, value);
    handleInput();
  }

  async function exportDocx() {
    const document = new DocxDocument({
      sections: [
        {
          properties: {},
          children: [
            new Paragraph({
              text: project.title,
              heading: HeadingLevel.HEADING_1,
            }),
            ...docxParagraphsFromHtml(latestHtmlRef.current),
          ],
        },
      ],
    });

    const blob = await Packer.toBlob(document);
    downloadBlob(blob, fileName(project.title, "docx"));
  }

  function exportPdf() {
    const printable = window.open("", "_blank", "noopener,noreferrer,width=900,height=700");
    if (!printable) {
      setMessage("Permite ventanas emergentes para exportar PDF.");
      return;
    }

    printable.document.open();
    printable.document.write(exportHtml(project.title, latestHtmlRef.current));
    printable.document.close();
    printable.focus();
    printable.print();
  }

  useEffect(() => {
    const nextDocument = projectDocument(project);

    if (project._id !== projectIdRef.current) {
      window.clearTimeout(backendSaveTimerRef.current);
      window.clearTimeout(realtimeSaveTimerRef.current);
      window.clearTimeout(cursorTimerRef.current);
      projectIdRef.current = project._id;
      queuedSaveRef.current = null;
      savingRef.current = false;
      dirtyRef.current = false;
      focusedRef.current = false;
      lastVersionRef.current = nextDocument.version;
      setDirty(false);
      setSaving(false);
      setMessage("");
      setRemoteCursors([]);
      setCursorBubbles([]);
      applyHtml(nextDocument.content);
      return;
    }

    if (!dirtyRef.current && nextDocument.version !== lastVersionRef.current) {
      lastVersionRef.current = nextDocument.version;
      applyHtml(nextDocument.content);
      setMessage("");
    }
  }, [project]);

  useEffect(() => {
    if (!realtimeEnabled || !project._id) {
      return;
    }

    let closed = false;
    void ensureRealtimeDocument(project._id, latestHtmlRef.current, documentInfo.updatedBy || currentUser).catch(() => {
      if (!closed) setRealtimeActive(false);
    });

    let unsubscribe: (() => void) | null = null;
    void subscribeRealtimeDocument(
      project._id,
      (realtimeDocument) => {
        if (closed) return;
        setRealtimeActive(true);

        if (realtimeDocument.updatedBy?.id === currentUser?.id) {
          return;
        }

        if (!dirtyRef.current || !focusedRef.current) {
          dirtyRef.current = false;
          setDirty(false);
          applyHtml(realtimeDocument.content);
          setMessage("");
        } else {
          setMessage("Hay cambios en vivo de otro usuario.");
        }
      },
      (cursors) => {
        if (closed) return;
        setRealtimeActive(true);
        setRemoteCursors(cursors.filter((cursor) => cursor.user.id !== currentUser?.id));
      }
    ).then((nextUnsubscribe) => {
      if (closed) {
        nextUnsubscribe?.();
        return;
      }

      unsubscribe = nextUnsubscribe;
    }).catch(() => {
      if (!closed) setRealtimeActive(false);
    });

    return () => {
      closed = true;
      unsubscribe?.();
      void clearRealtimeCursor(project._id, currentUser?.id);
    };
  }, [currentUser, documentInfo.updatedBy, project._id, realtimeEnabled]);

  useEffect(
    () => () => {
      window.clearTimeout(backendSaveTimerRef.current);
      window.clearTimeout(realtimeSaveTimerRef.current);
      window.clearTimeout(cursorTimerRef.current);
    },
    []
  );

  useEffect(() => {
    const editor = editorRef.current;
    const surface = surfaceRef.current;
    if (!editor || !surface) return;

    const timer = window.requestAnimationFrame(() => {
      setCursorBubbles(
        remoteCursors.map((cursor) => ({
          user: cursor.user,
          ...cursorPoint(editor, surface, cursor.cursorOffset),
        }))
      );
    });

    return () => window.cancelAnimationFrame(timer);
  }, [contentHtml, remoteCursors]);

  return (
    <section className="project-card document-editor-card">
      <div className="document-editor-head">
        <div>
          <p className="eyebrow">DOCUMENTO</p>
          <h4>Editor colaborativo</h4>
          <span>{realtimeEnabled ? (realtimeActive ? "Firebase en vivo" : "Conectando Firebase") : "Firebase no configurado"}</span>
        </div>
        <span className={`document-save-state ${saveStateClass}`}>{canEdit ? saveState : "Solo lectura"}</span>
      </div>

      <div className="document-toolbar" aria-label="Herramientas del documento">
        <div className="document-toolbar-group">
          <button type="button" onClick={() => format("bold")} title="Negrita">
            B
          </button>
          <button type="button" onClick={() => format("italic")} title="Cursiva">
            I
          </button>
          <button type="button" onClick={() => format("underline")} title="Subrayado">
            U
          </button>
        </div>
        <div className="document-toolbar-group">
          <select onChange={(event) => format("formatBlock", event.target.value)} defaultValue="p" title="Tipo de texto">
            <option value="p">Texto</option>
            <option value="h2">Título</option>
            <option value="h3">Subtítulo</option>
          </select>
          <select onChange={(event) => format("fontName", event.target.value)} defaultValue="Arial" title="Fuente">
            <option value="Arial">Arial</option>
            <option value="Georgia">Georgia</option>
            <option value="Courier New">Courier</option>
          </select>
          <select onChange={(event) => format("fontSize", event.target.value)} defaultValue="3" title="Tamaño">
            {fontSizes.map((size) => (
              <option key={size.value} value={size.value}>
                {size.label}
              </option>
            ))}
          </select>
        </div>
        <div className="document-toolbar-group">
          <input type="color" title="Color de texto" onChange={(event) => format("foreColor", event.target.value)} />
          <input type="color" title="Resaltado" onChange={(event) => format("hiliteColor", event.target.value)} />
        </div>
        <div className="document-toolbar-group">
          <button type="button" onClick={() => format("insertUnorderedList")} title="Lista">
            Lista
          </button>
          <button type="button" onClick={() => format("justifyLeft")} title="Alinear izquierda">
            Izq.
          </button>
          <button type="button" onClick={() => format("justifyCenter")} title="Centrar">
            Centro
          </button>
          <button type="button" onClick={() => format("removeFormat")} title="Quitar formato">
            Limpiar
          </button>
        </div>
        <div className="document-toolbar-group document-export-actions">
          <input
            ref={wordInputRef}
            className="document-file-input"
            type="file"
            accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={(event) => void importWordFile(event.target.files?.[0])}
          />
          <button type="button" onClick={() => wordInputRef.current?.click()} title="Importar archivo de Word">
            Importar Word
          </button>
          <button type="button" onClick={() => void exportDocx()}>
            DOCX
          </button>
          <button type="button" onClick={exportPdf}>
            PDF
          </button>
        </div>
      </div>

      <label className="document-editor-field">
        <span>Contenido</span>
        <div ref={surfaceRef} className="document-editor-surface">
          {fallbackEditors.length > 0 && !remoteCursors.length && (
            <div className="document-floating-presence" aria-live="polite">
              {fallbackEditors.slice(0, 3).map((editor) => (
                <span key={editor.id}>
                  <b style={{ backgroundColor: editor.avatarColor || "#2a8b7b" }}>
                    {editor.name.trim().charAt(0).toUpperCase() || "U"}
                  </b>
                  <small>{editor.name} está editando aquí</small>
                </span>
              ))}
            </div>
          )}

          <div
            ref={editorRef}
            className="rich-document-editor"
            contentEditable={canEdit}
            suppressContentEditableWarning
            onBlur={() => {
              focusedRef.current = false;
              void clearRealtimeCursor(project._id, currentUser?.id);
            }}
            onFocus={() => {
              focusedRef.current = true;
              onActivity("documento", "editando el documento");
              publishCursor(0);
            }}
            onInput={handleInput}
            onKeyUp={() => publishCursor(0)}
            onMouseUp={() => publishCursor(0)}
            dangerouslySetInnerHTML={{ __html: sanitizeEditorHtml(contentHtml) }}
            data-placeholder="Escribe aquí el documento del proyecto"
          />

          <div className="document-cursor-layer" aria-live="polite">
            {cursorBubbles.map((cursor) => (
              <span
                key={cursor.user.id}
                className="document-cursor-bubble"
                style={{ left: cursor.left, top: cursor.top, borderColor: cursor.user.avatarColor || "#2a8b7b" }}
              >
                <b style={{ backgroundColor: cursor.user.avatarColor || "#2a8b7b" }}>
                  {cursor.user.name.trim().charAt(0).toUpperCase() || "U"}
                </b>
                {cursor.user.name}
              </span>
            ))}
          </div>
        </div>
      </label>

      <div className="document-editor-foot">
        <span>
          {plainLength.toLocaleString("es-MX")}/{maxDocumentLength.toLocaleString("es-MX")} caracteres · {lastUpdate}
        </span>
        <button
          className="btn btn-compact"
          type="button"
          disabled={!canEdit || saving || !dirty}
          onClick={() => {
            window.clearTimeout(backendSaveTimerRef.current);
            window.clearTimeout(realtimeSaveTimerRef.current);
            void saveRealtimeDocument(project._id, latestHtmlRef.current, currentUser).catch(() => {});
            void saveDocument(project._id, latestHtmlRef.current);
          }}
        >
          Guardar ahora
        </button>
      </div>

      {message && <p className="inline-message">{message}</p>}
    </section>
  );
}
