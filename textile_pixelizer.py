"""
Textile Pixelizer — Raster-to-Pixel Conversion Tool for Textile CAD

Converts sketch images into clean, smooth pixelized designs suitable
for textile manufacturing workflows. Exports industry-standard 24-bit
BMP files compatible with NedGraphics, EAT, and other textile CAD software.

Usage:
    python textile_pixelizer.py

Requirements:
    pip install opencv-python numpy Pillow
"""

import sys
import os

# ── Dependency Check ──
try:
    import cv2
    import numpy as np
    from PIL import Image, ImageTk
except ImportError as e:
    print(f"Missing dependency: {e}")
    print("Install with:  pip install opencv-python numpy Pillow")
    sys.exit(1)

import tkinter as tk
from tkinter import ttk, filedialog, messagebox
from pathlib import Path
import threading
import time


# ════════════════════════════════════════════════════════════════════
# THEME CONSTANTS (BLACK AND WHITE)
# ════════════════════════════════════════════════════════════════════

C = {
    'bg':        '#ffffff',   # Pure white
    'surface':   '#f8f8f8',   # Off white
    'panel':     '#ffffff',   # White
    'elevated':  '#000000',   # Pure black (for buttons)
    'border':    '#000000',   # Black borders
    'text':      '#000000',   # Black text
    'text2':     '#444444',   # Dark gray text
    'accent':    '#333333',   # Dark gray for hover states
    'accent2':   '#000000',   # Black
    'success':   '#000000',   # Black
    'warning':   '#000000',   # Black
    'error':     '#000000',   # Black
    'white':     '#ffffff',   # White
    'trough':    '#eeeeee',   # Light gray for scrollbars/sliders
}

FONT = 'Segoe UI'


# ════════════════════════════════════════════════════════════════════
# PIXELIZATION PIPELINE
# ════════════════════════════════════════════════════════════════════

class Pipeline:
    """Core CV pipeline: raster sketch → clean pixelized grid."""

    @staticmethod
    def process(img_bgr, params):
        """
        Full processing pipeline dispatcher.
        """
        mode = params.get('mode', 'bw')
        if mode == 'color':
            return Pipeline._process_color(img_bgr, params)
        return Pipeline._process_bw(img_bgr, params)

    @staticmethod
    def _process_bw(img_bgr, params):
        """B&W pipeline: optimized for pencil sketches."""
        h, w = img_bgr.shape[:2]

        # ── 1. Grayscale ──
        gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)

        # ── 2. Background Normalization ──
        if params.get('normalize_bg', False):
            bg = cv2.GaussianBlur(gray, (51, 51), 0)
            gray = cv2.divide(gray, bg, scale=255)

        # ── 3. Light Pre-filtering ──
        d = params.get('bilateral_d', 5)
        sc = params.get('sigma_color', 30)
        ss = params.get('sigma_space', 30)
        if d > 0:
            filtered = cv2.bilateralFilter(gray, d, sc, ss)
        else:
            filtered = gray.copy()

        # ── 4. Downscale FIRST (Preserves stroke thickness) ──
        ps = max(1, params.get('pixel_size', 4))
        gw = max(1, w // ps)
        gh = max(1, h // ps)
        
        # INTER_AREA averages the pixels, so pencil strokes darken the grid cells
        small = cv2.resize(filtered, (gw, gh), interpolation=cv2.INTER_AREA)

        # ── 5. Adaptive Threshold on Downscaled Image ──
        bs = params.get('block_size', 15)
        if bs % 2 == 0:
            bs += 1
        bs = max(3, bs)
        tc = params.get('threshold_c', 5)
        
        binary = cv2.adaptiveThreshold(
            small, 255,
            cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
            cv2.THRESH_BINARY,
            bs, tc
        )

        # ── 6. Median Smoothing (Remove jagged boundaries) ──
        mk = params.get('median_k', 3)
        if mk > 1:
            if mk % 2 == 0:
                mk += 1
            binary = cv2.medianBlur(binary, mk)
            _, binary = cv2.threshold(binary, 127, 255, cv2.THRESH_BINARY)

        # ── 7. Morphological Closing (Seal gaps) ──
        ci = params.get('close_iters', 1)
        if ci > 0:
            kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
            binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel, iterations=ci)

        # ── 8. Despeckle (Remove tiny noise) ──
        desp = params.get('despeckle', 5)
        if desp > 0:
            inv = cv2.bitwise_not(binary)
            contours, _ = cv2.findContours(
                inv, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE
            )
            for cnt in contours:
                if cv2.contourArea(cnt) < desp:
                    cv2.drawContours(binary, [cnt], -1, 255, -1)

        # ── 9. Invert if requested ──
        if params.get('invert', False):
            binary = cv2.bitwise_not(binary)

        grid = binary

        # ── 10. Upscale for Display ──
        disp_w = gw * ps
        disp_h = gh * ps
        display = cv2.resize(grid, (disp_w, disp_h), interpolation=cv2.INTER_NEAREST)

        # ── 11. Grid Overlay ──
        if params.get('show_grid', False):
            for x in range(0, disp_w, ps):
                cv2.line(display, (x, 0), (x, disp_h - 1), 128, 1)
            for y in range(0, disp_h, ps):
                cv2.line(display, (0, y), (disp_w - 1, y), 128, 1)

        return {
            'grid': grid,
            'display': display,
            'grid_size': (gw, gh),
            'original_size': (w, h),
        }

    @staticmethod
    def _process_color(img_bgr, params):
        """Color pipeline: image → K-means quantize → pixelized grid."""
        h, w = img_bgr.shape[:2]
        ps = max(1, params.get('pixel_size', 4))
        gw = max(1, w // ps)
        gh = max(1, h // ps)
        nc = max(2, params.get('num_colors', 4))

        # ── Bilateral Filter ──
        d = params.get('bilateral_d', 9)
        sc = params.get('sigma_color', 75)
        ss = params.get('sigma_space', 75)
        filtered = cv2.bilateralFilter(img_bgr, d, sc, ss) if d > 0 else img_bgr.copy()

        # ── Downscale ──
        small = cv2.resize(filtered, (gw, gh), interpolation=cv2.INTER_AREA)

        # ── K-Means Color Quantization ──
        pixels = small.reshape(-1, 3).astype(np.float32)
        criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 20, 1.0)
        _, labels, centers = cv2.kmeans(
            pixels, nc, None, criteria, 5, cv2.KMEANS_PP_CENTERS
        )
        centers = np.uint8(centers)
        quantized = centers[labels.flatten()].reshape(small.shape)

        # ── Median Smoothing ──
        mk = params.get('median_k', 3)
        if mk > 1:
            if mk % 2 == 0:
                mk += 1
            for _ in range(params.get('smooth_passes', 1)):
                quantized = cv2.medianBlur(quantized, mk)
            # Re-quantize to strict centers
            px = quantized.reshape(-1, 3).astype(np.float32)
            cf = centers.astype(np.float32)
            dists = np.linalg.norm(px[:, np.newaxis, :] - cf[np.newaxis, :, :], axis=2)
            new_labels = np.argmin(dists, axis=1)
            quantized = centers[new_labels].reshape(small.shape)

        grid = quantized

        # ── Upscale for Display ──
        disp_w = gw * ps
        disp_h = gh * ps
        display = cv2.resize(grid, (disp_w, disp_h), interpolation=cv2.INTER_NEAREST)

        # ── Grid Overlay ──
        if params.get('show_grid', False):
            for x in range(0, disp_w, ps):
                cv2.line(display, (x, 0), (x, disp_h - 1), (128, 128, 128), 1)
            for y in range(0, disp_h, ps):
                cv2.line(display, (0, y), (disp_w - 1, y), (128, 128, 128), 1)

        return {
            'grid': grid,
            'display': display,
            'grid_size': (gw, gh),
            'original_size': (w, h),
            'palette': centers.tolist(),
        }


# ════════════════════════════════════════════════════════════════════
# ZOOMABLE IMAGE VIEWER WIDGET
# ════════════════════════════════════════════════════════════════════

class ImageViewer(tk.Frame):
    """Canvas-based image viewer with smooth zoom & pan."""

    def __init__(self, parent, bg_color='#ffffff'):
        super().__init__(parent, bg=bg_color)

        self.canvas = tk.Canvas(
            self, bg=bg_color, highlightthickness=1, 
            highlightbackground='#000000', cursor='crosshair'
        )
        self.v_sb = ttk.Scrollbar(
            self, orient='vertical', command=self.canvas.yview
        )
        self.h_sb = ttk.Scrollbar(
            self, orient='horizontal', command=self.canvas.xview
        )
        self.canvas.configure(
            xscrollcommand=self.h_sb.set,
            yscrollcommand=self.v_sb.set
        )

        self.canvas.grid(row=0, column=0, sticky='nsew', padx=2, pady=2)
        self.v_sb.grid(row=0, column=1, sticky='ns')
        self.h_sb.grid(row=1, column=0, sticky='ew')
        self.grid_rowconfigure(0, weight=1)
        self.grid_columnconfigure(0, weight=1)

        self._pil = None
        self._photo = None
        self._zoom = 1.0
        self._drag = None

        self.canvas.bind('<MouseWheel>', self._on_wheel)
        self.canvas.bind('<ButtonPress-1>', self._on_drag_start)
        self.canvas.bind('<B1-Motion>', self._on_drag_move)
        self.canvas.bind('<ButtonRelease-1>', self._on_drag_end)
        self.canvas.bind('<Double-Button-1>', lambda e: self.fit())

        self._info_id = None

    def set_image(self, cv_img):
        if cv_img is None:
            self._pil = None
            self.canvas.delete('all')
            return
        if len(cv_img.shape) == 2:
            rgb = cv2.cvtColor(cv_img, cv2.COLOR_GRAY2RGB)
        else:
            rgb = cv2.cvtColor(cv_img, cv2.COLOR_BGR2RGB)
        self._pil = Image.fromarray(rgb)
        self._refresh()

    def fit(self):
        if not self._pil: return
        cw = max(1, self.canvas.winfo_width())
        ch = max(1, self.canvas.winfo_height())
        zx = cw / self._pil.width
        zy = ch / self._pil.height
        self._zoom = min(zx, zy) * 0.95
        self._refresh()
        self.canvas.xview_moveto(0)
        self.canvas.yview_moveto(0)

    def zoom_in(self):
        self._zoom = min(40, self._zoom * 1.5)
        self._refresh()

    def zoom_out(self):
        self._zoom = max(0.02, self._zoom / 1.5)
        self._refresh()

    def _refresh(self):
        if not self._pil: return
        w = max(1, int(self._pil.width * self._zoom))
        h = max(1, int(self._pil.height * self._zoom))
        method = Image.NEAREST if self._zoom >= 1.5 else Image.LANCZOS
        resized = self._pil.resize((w, h), method)
        self._photo = ImageTk.PhotoImage(resized)
        self.canvas.delete('all')
        self.canvas.create_image(0, 0, anchor='nw', image=self._photo)
        self.canvas.configure(scrollregion=(0, 0, w, h))
        pct = int(self._zoom * 100)
        self._info_id = self.canvas.create_text(
            10, 10, anchor='nw', text=f'{pct}%',
            fill='#000000', font=(FONT, 10, 'bold')
        )

    def _on_wheel(self, event):
        if not self._pil: return
        old_zoom = self._zoom
        factor = 1.2 if event.delta > 0 else 1 / 1.2
        self._zoom = max(0.02, min(40, self._zoom * factor))
        cx = self.canvas.canvasx(event.x)
        cy = self.canvas.canvasy(event.y)
        ratio = self._zoom / old_zoom
        self._refresh()
        new_cx = cx * ratio
        new_cy = cy * ratio
        img_w = max(1, self._pil.width * self._zoom)
        img_h = max(1, self._pil.height * self._zoom)
        self.canvas.xview_moveto((new_cx - event.x) / img_w if img_w > 0 else 0)
        self.canvas.yview_moveto((new_cy - event.y) / img_h if img_h > 0 else 0)

    def _on_drag_start(self, event):
        self._drag = (event.x, event.y)
        self.canvas.configure(cursor='fleur')

    def _on_drag_move(self, event):
        if self._drag:
            dx = self._drag[0] - event.x
            dy = self._drag[1] - event.y
            self.canvas.xview_scroll(dx, 'units')
            self.canvas.yview_scroll(dy, 'units')
            self._drag = (event.x, event.y)

    def _on_drag_end(self, event):
        self._drag = None
        self.canvas.configure(cursor='crosshair')


# ════════════════════════════════════════════════════════════════════
# MAIN APPLICATION
# ════════════════════════════════════════════════════════════════════

class TextilePixelizer:
    def __init__(self, root):
        self.root = root
        self.root.title('Textile Pixelizer — Black & White Theme')
        self.root.geometry('1440x880')
        self.root.minsize(960, 640)
        self.root.configure(bg=C['bg'])

        self.original = None
        self.result = None
        self.file_path = None
        self._process_timer = None
        self._processing = False
        self._initial_load = False

        # Parameters based on the improved 'a4_adaptive_small' approach
        self.v = {}
        defs = {
            'pixel_size':     ('int', 4),
            'num_colors':     ('int', 2),
            'bilateral_d':    ('int', 5),
            'sigma_color':    ('int', 30),
            'sigma_space':    ('int', 30),
            'block_size':     ('int', 15),
            'threshold_c':    ('int', 5),
            'close_iters':    ('int', 1),
            'despeckle':      ('int', 5),
            'median_k':       ('int', 3),
            'smooth_passes':  ('int', 1),
        }
        for name, (vtype, default) in defs.items():
            var = tk.IntVar(value=default) if vtype == 'int' else tk.DoubleVar(value=default)
            var.trace_add('write', self._on_param_change)
            self.v[name] = var

        self.v['mode'] = tk.StringVar(value='bw')
        self.v['mode'].trace_add('write', self._on_param_change)
        self.v['normalize_bg'] = tk.BooleanVar(value=False)
        self.v['normalize_bg'].trace_add('write', self._on_param_change)
        self.v['show_grid'] = tk.BooleanVar(value=False)
        self.v['show_grid'].trace_add('write', self._on_param_change)
        self.v['invert'] = tk.BooleanVar(value=False)
        self.v['invert'].trace_add('write', self._on_param_change)
        self.v['view'] = tk.StringVar(value='processed')
        self.v['view'].trace_add('write', lambda *a: self._update_view())

        self._setup_styles()
        self._build_toolbar()
        self._build_main_area()
        self._build_statusbar()

        self.root.bind('<Control-o>', lambda e: self.open_file())
        self.root.bind('<Control-s>', lambda e: self.export_bmp())
        self.root.bind('<Control-Shift-S>', lambda e: self.export_png())
        self.root.bind('<space>', lambda e: self._toggle_view())

        self._set_status('Ready — Open an image to begin', 'info')

    def _setup_styles(self):
        s = ttk.Style()
        s.theme_use('clam')

        s.configure('Dark.TFrame', background=C['bg'])
        s.configure('Surface.TFrame', background=C['surface'])
        s.configure('Panel.TFrame', background=C['panel'])

        for name, bg, fg, font_spec in [
            ('Dark.TLabel',    C['surface'], C['text'],    (FONT, 10)),
            ('Panel.TLabel',   C['panel'],   C['text'],    (FONT, 10)),
            ('Section.TLabel', C['panel'],   C['accent2'], (FONT, 11, 'bold')),
            ('Value.TLabel',   C['panel'],   C['text2'],   (FONT, 10, 'bold')),
            ('Status.TLabel',  C['bg'],      C['text'],    (FONT, 9)),
            ('StatusOK.TLabel', C['bg'],     C['text'],    (FONT, 9, 'bold')),
            ('Title.TLabel',   C['surface'], C['accent2'], (FONT, 14, 'bold')),
        ]:
            s.configure(name, background=bg, foreground=fg, font=font_spec)

        # Black Buttons
        s.configure('Tool.TButton', background=C['elevated'], foreground=C['white'], 
                    font=(FONT, 9, 'bold'), padding=(12, 6), borderwidth=0)
        s.map('Tool.TButton', background=[('active', C['accent'])])

        s.configure('Accent.TButton', background=C['elevated'], foreground=C['white'], 
                    font=(FONT, 10, 'bold'), padding=(16, 10), borderwidth=0)
        s.map('Accent.TButton', background=[('active', C['accent'])])

        # White Checkbuttons/Radiobuttons
        for wtype in ('TCheckbutton', 'TRadiobutton'):
            s.configure(f'Dark.{wtype}', background=C['panel'], foreground=C['text'], font=(FONT, 10))
            s.map(f'Dark.{wtype}', background=[('active', C['panel'])])

        s.configure('Vertical.TScrollbar', background=C['elevated'], troughcolor=C['trough'], borderwidth=0)
        s.configure('Dark.TSeparator', background=C['border'])

    def _build_toolbar(self):
        bar = tk.Frame(self.root, bg=C['surface'], height=56, highlightthickness=1, highlightbackground=C['border'])
        bar.pack(fill='x')
        bar.pack_propagate(False)

        inner = tk.Frame(bar, bg=C['surface'])
        inner.pack(fill='both', expand=True, padx=10, pady=8)

        ttk.Label(inner, text='  ■ TEXTILE PIXELIZER', style='Title.TLabel').pack(side='left', padx=(4, 16))
        tk.Frame(inner, width=1, bg=C['border']).pack(side='left', fill='y', padx=8, pady=2)

        for text, cmd in [('Open Image', self.open_file), ('Batch Process', self.batch_process)]:
            ttk.Button(inner, text=text, command=cmd, style='Tool.TButton').pack(side='left', padx=3)

        tk.Frame(inner, width=1, bg=C['border']).pack(side='left', fill='y', padx=8, pady=2)

        ttk.Button(inner, text='Export BMP', command=self.export_bmp, style='Tool.TButton').pack(side='left', padx=3)
        ttk.Button(inner, text='Export PNG', command=self.export_png, style='Tool.TButton').pack(side='left', padx=3)

        for text, cmd in [('Fit', self._fit_view), ('-', self._zoom_out), ('+', self._zoom_in)]:
            ttk.Button(inner, text=text, command=cmd, style='Tool.TButton').pack(side='right', padx=2)

    def _build_main_area(self):
        main = tk.Frame(self.root, bg=C['bg'])
        main.pack(fill='both', expand=True, padx=6, pady=(4, 4))

        left = tk.Frame(main, bg=C['bg'])
        left.pack(side='left', fill='both', expand=True)

        view_bar = tk.Frame(left, bg=C['surface'], highlightthickness=1, highlightbackground=C['border'])
        view_bar.pack(fill='x', pady=(0, 4))

        for text, val in [('Original', 'original'), ('Processed', 'processed'), ('Export Preview', 'grid')]:
            ttk.Radiobutton(view_bar, text=text, variable=self.v['view'], value=val, style='Dark.TRadiobutton').pack(side='left', padx=10, pady=5)

        self.viewer = ImageViewer(left, bg_color=C['bg'])
        self.viewer.pack(fill='both', expand=True)

        panel = tk.Frame(main, bg=C['panel'], width=340, highlightthickness=1, highlightbackground=C['border'])
        panel.pack(side='right', fill='y', padx=(6, 0))
        panel.pack_propagate(False)

        self._ctrl_canvas = tk.Canvas(panel, bg=C['panel'], highlightthickness=0, width=320)
        ctrl_sb = ttk.Scrollbar(panel, orient='vertical', command=self._ctrl_canvas.yview)
        self._ctrl_inner = tk.Frame(self._ctrl_canvas, bg=C['panel'])

        self._ctrl_inner.bind('<Configure>', lambda e: self._ctrl_canvas.configure(scrollregion=self._ctrl_canvas.bbox('all')))
        self._ctrl_canvas.create_window((0, 0), window=self._ctrl_inner, anchor='nw', width=310)
        self._ctrl_canvas.configure(yscrollcommand=ctrl_sb.set)

        self._ctrl_canvas.pack(side='left', fill='both', expand=True, padx=4)
        ctrl_sb.pack(side='right', fill='y')

        def _ctrl_wheel(event):
            self._ctrl_canvas.yview_scroll(int(-1 * (event.delta / 120)), 'units')
        self._ctrl_canvas.bind('<Enter>', lambda e: self._ctrl_canvas.bind_all('<MouseWheel>', _ctrl_wheel))
        self._ctrl_canvas.bind('<Leave>', lambda e: self._ctrl_canvas.unbind_all('<MouseWheel>'))

        self._build_controls(self._ctrl_inner)

    def _build_controls(self, parent):
        self._section(parent, '■ PIXEL GRID')
        self._slider(parent, 'Pixel Size', self.v['pixel_size'], 1, 20)
        
        mode_fr = tk.Frame(parent, bg=C['panel'])
        mode_fr.pack(fill='x', padx=14, pady=(6, 2))
        tk.Label(mode_fr, text='Mode:', bg=C['panel'], fg=C['text'], font=(FONT, 10, 'bold')).pack(side='left')
        for txt, val in [('B&W', 'bw'), ('Color', 'color')]:
            ttk.Radiobutton(mode_fr, text=txt, variable=self.v['mode'], value=val, style='Dark.TRadiobutton').pack(side='left', padx=10)

        self._slider(parent, 'Num Colors (Color)', self.v['num_colors'], 2, 16)
        self._sep(parent)

        self._section(parent, '■ PRE-PROCESSING')
        self._check(parent, 'Normalize Background', self.v['normalize_bg'])
        self._slider(parent, 'Bilateral D (Noise)', self.v['bilateral_d'], 0, 15)
        self._sep(parent)

        self._section(parent, '■ THRESHOLDING (B&W)')
        self._slider(parent, 'Block Size', self.v['block_size'], 3, 51)
        self._slider(parent, 'Constant C', self.v['threshold_c'], 0, 20)
        self._sep(parent)

        self._section(parent, '■ SMOOTHING & CLEANUP')
        self._slider(parent, 'Median Blur', self.v['median_k'], 1, 9)
        self._slider(parent, 'Close Iterations', self.v['close_iters'], 0, 5)
        self._slider(parent, 'Despeckle Min Size', self.v['despeckle'], 0, 100)
        self._sep(parent)

        self._section(parent, '■ DISPLAY OPTIONS')
        self._check(parent, 'Show Grid Overlay', self.v['show_grid'])
        self._check(parent, 'Invert Output', self.v['invert'])
        self._sep(parent)

        bf = tk.Frame(parent, bg=C['panel'])
        bf.pack(fill='x', padx=14, pady=(8, 16))
        ttk.Button(bf, text='PROCESS NOW', style='Accent.TButton', command=self.process_now).pack(fill='x', pady=4)
        ttk.Button(bf, text='Reset Defaults', style='Tool.TButton', command=self._reset_defaults).pack(fill='x', pady=2)

    def _section(self, parent, text):
        tk.Label(parent, text=text, bg=C['panel'], fg=C['text'], font=(FONT, 11, 'bold'), anchor='w').pack(fill='x', padx=14, pady=(14, 4))

    def _slider(self, parent, label, var, from_, to):
        frame = tk.Frame(parent, bg=C['panel'])
        frame.pack(fill='x', padx=14, pady=2)
        top = tk.Frame(frame, bg=C['panel'])
        top.pack(fill='x')
        tk.Label(top, text=label, bg=C['panel'], fg=C['text'], font=(FONT, 9), anchor='w').pack(side='left')
        val_lbl = tk.Label(top, text=str(var.get()), bg=C['panel'], fg=C['text'], font=(FONT, 9, 'bold'), width=5, anchor='e')
        val_lbl.pack(side='right')

        scale = tk.Scale(
            frame, from_=from_, to=to, variable=var, orient=tk.HORIZONTAL, resolution=1,
            bg=C['panel'], fg=C['text'], troughcolor=C['trough'], activebackground=C['text'],
            highlightthickness=1, highlightbackground=C['border'], sliderrelief='flat', bd=0,
            sliderlength=18, width=14, showvalue=0,
        )
        scale.pack(fill='x', pady=(0, 2))

        def _update(*args):
            val_lbl.config(text=str(var.get()))
        var.trace_add('write', _update)

    def _check(self, parent, label, var):
        ttk.Checkbutton(parent, text=label, variable=var, style='Dark.TCheckbutton').pack(fill='x', padx=14, pady=3)

    def _sep(self, parent):
        tk.Frame(parent, height=1, bg=C['border']).pack(fill='x', padx=14, pady=8)

    def _build_statusbar(self):
        bar = tk.Frame(self.root, bg=C['surface'], height=28, highlightthickness=1, highlightbackground=C['border'])
        bar.pack(fill='x')
        bar.pack_propagate(False)

        self.status_lbl = ttk.Label(bar, text='', style='Status.TLabel')
        self.status_lbl.pack(side='left', padx=12)

        self.info_lbl = ttk.Label(bar, text='', style='Status.TLabel')
        self.info_lbl.pack(side='right', padx=12)

    def open_file(self):
        init_dir = str(Path(self.file_path).parent) if self.file_path else None
        path = filedialog.askopenfilename(
            title='Open Image', initialdir=init_dir,
            filetypes=[('Image Files', '*.jpg *.jpeg *.png *.bmp *.tiff *.tif *.webp'), ('All Files', '*.*')]
        )
        if path:
            self.load_image(path)

    def load_image(self, path):
        try:
            img = cv2.imdecode(np.fromfile(path, dtype=np.uint8), cv2.IMREAD_COLOR)
            if img is None: raise ValueError(f'Cannot read image: {path}')
            self.original = img
            self.file_path = path
            self.result = None

            h, w = img.shape[:2]
            name = Path(path).name
            self.info_lbl.config(text=f'{name} | {w}x{h}')

            self.v['view'].set('original')
            self.viewer.set_image(img)
            self.root.after(100, self.viewer.fit)

            self._initial_load = True
            self._set_status(f'Loaded: {name} | Processing...', 'info')
            self.root.after(200, self._do_process)
        except Exception as e:
            messagebox.showerror('Error', str(e))
            self._set_status(f'Error: {e}', 'error')

    def _on_param_change(self, *args):
        if self._process_timer: self.root.after_cancel(self._process_timer)
        self._process_timer = self.root.after(350, self._do_process)

    def process_now(self):
        self._do_process()

    def _do_process(self):
        if self.original is None or self._processing: return
        self._processing = True
        self._set_status('Processing...', 'info')
        threading.Thread(target=self._process_worker, daemon=True).start()

    def _process_worker(self):
        try:
            params = self._get_params()
            t0 = time.time()
            result = Pipeline.process(self.original, params)
            elapsed = time.time() - t0
            self.result = result
            gw, gh = result['grid_size']
            self.root.after(0, lambda: self._on_process_done(gw, gh, elapsed))
        except Exception as e:
            self.root.after(0, lambda: self._set_status(f'Error: {e}', 'error'))
        finally:
            self._processing = False

    def _on_process_done(self, gw, gh, elapsed):
        ms = int(elapsed * 1000)
        self._set_status(f'Done | Grid: {gw}x{gh} ({ms}ms)', 'success')
        if self.file_path:
            name = Path(self.file_path).name
            w, h = self.result['original_size']
            self.info_lbl.config(text=f'{name} | {w}x{h} -> {gw}x{gh}')

        if self._initial_load:
            self._initial_load = False
            self.v['view'].set('processed')
        else:
            view = self.v['view'].get()
            if view in ('processed', 'grid'):
                self._update_view()

    def _get_params(self):
        return {
            'pixel_size':     self.v['pixel_size'].get(),
            'mode':           self.v['mode'].get(),
            'num_colors':     self.v['num_colors'].get(),
            'normalize_bg':   self.v['normalize_bg'].get(),
            'bilateral_d':    self.v['bilateral_d'].get(),
            'sigma_color':    self.v['sigma_color'].get(),
            'sigma_space':    self.v['sigma_space'].get(),
            'block_size':     self.v['block_size'].get(),
            'threshold_c':    self.v['threshold_c'].get(),
            'close_iters':    self.v['close_iters'].get(),
            'despeckle':      self.v['despeckle'].get(),
            'median_k':       self.v['median_k'].get(),
            'smooth_passes':  self.v['smooth_passes'].get(),
            'show_grid':      self.v['show_grid'].get(),
            'invert':         self.v['invert'].get(),
        }

    def _update_view(self):
        view = self.v['view'].get()
        if view == 'original' and self.original is not None:
            self.viewer.set_image(self.original)
        elif view == 'processed' and self.result:
            self.viewer.set_image(self.result['display'])
        elif view == 'grid' and self.result:
            self.viewer.set_image(self.result['grid'])
        else: return
        self.root.after(50, self.viewer.fit)

    def _toggle_view(self):
        cur = self.v['view'].get()
        if cur == 'original': self.v['view'].set('processed')
        elif cur == 'processed': self.v['view'].set('grid')
        else: self.v['view'].set('original')

    def _fit_view(self): self.viewer.fit()
    def _zoom_in(self): self.viewer.zoom_in()
    def _zoom_out(self): self.viewer.zoom_out()

    def export_bmp(self):
        if not self.result:
            messagebox.showwarning('No Data', 'Process an image first!')
            return
        stem = Path(self.file_path).stem if self.file_path else 'output'
        ps = self.v['pixel_size'].get()
        default = f'{stem}_pixel_{ps}px.bmp'
        init_dir = str(Path(self.file_path).parent) if self.file_path else None

        path = filedialog.asksaveasfilename(
            title='Export BMP', defaultextension='.bmp', initialfile=default,
            initialdir=init_dir, filetypes=[('BMP Files', '*.bmp'), ('All Files', '*.*')]
        )
        if not path: return

        grid = self.result['grid']
        if len(grid.shape) == 2: grid = cv2.cvtColor(grid, cv2.COLOR_GRAY2BGR)
        success, buf = cv2.imencode('.bmp', grid)
        if success:
            with open(path, 'wb') as f: f.write(buf.tobytes())
            gw, gh = self.result['grid_size']
            self._set_status(f'Exported BMP: {Path(path).name} ({gw}x{gh})', 'success')
        else:
            self._set_status('BMP export failed!', 'error')

    def export_png(self):
        if not self.result:
            messagebox.showwarning('No Data', 'Process an image first!')
            return
        stem = Path(self.file_path).stem if self.file_path else 'output'
        ps = self.v['pixel_size'].get()
        default = f'{stem}_pixel_{ps}px.png'
        init_dir = str(Path(self.file_path).parent) if self.file_path else None

        path = filedialog.asksaveasfilename(
            title='Export PNG', defaultextension='.png', initialfile=default,
            initialdir=init_dir, filetypes=[('PNG Files', '*.png'), ('All Files', '*.*')]
        )
        if not path: return

        grid = self.result['grid']
        if len(grid.shape) == 2: grid = cv2.cvtColor(grid, cv2.COLOR_GRAY2BGR)
        success, buf = cv2.imencode('.png', grid)
        if success:
            with open(path, 'wb') as f: f.write(buf.tobytes())
            self._set_status(f'Exported PNG: {Path(path).name}', 'success')
        else:
            self._set_status('PNG export failed!', 'error')

    def batch_process(self):
        folder = filedialog.askdirectory(title='Select Folder with Images')
        if not folder: return

        exts = {'.jpg', '.jpeg', '.png', '.bmp', '.tiff', '.tif', '.webp'}
        files = sorted([f for f in Path(folder).iterdir() if f.is_file() and f.suffix.lower() in exts])

        if not files:
            messagebox.showinfo('No Images', 'No image files found in the selected folder.')
            return

        out_dir = Path(folder) / 'pixelized_output'
        out_dir.mkdir(exist_ok=True)

        params = self._get_params()
        count, errors, total = 0, 0, len(files)

        self._set_status(f'Batch: 0 / {total}...', 'info')
        self.root.update()

        for i, f in enumerate(files):
            try:
                img = cv2.imdecode(np.fromfile(str(f), dtype=np.uint8), cv2.IMREAD_COLOR)
                if img is None:
                    errors += 1
                    continue
                result = Pipeline.process(img, params)
                grid = result['grid']
                if len(grid.shape) == 2: grid = cv2.cvtColor(grid, cv2.COLOR_GRAY2BGR)

                out_name = f'{f.stem}_pixel_{params["pixel_size"]}px.bmp'
                out_path = out_dir / out_name
                success, buf = cv2.imencode('.bmp', grid)
                if success:
                    with open(str(out_path), 'wb') as fp: fp.write(buf.tobytes())
                count += 1
                self._set_status(f'Batch: {i + 1} / {total}...', 'info')
                self.root.update()
            except Exception as e:
                print(f'Error processing {f.name}: {e}')
                errors += 1

        msg = f'Batch complete: {count} images processed'
        if errors: msg += f', {errors} errors'
        self._set_status(msg, 'success')
        messagebox.showinfo('Batch Complete', f'{msg}\n\nOutput: {out_dir}')

    def _reset_defaults(self):
        defaults = {
            'pixel_size': 4, 'num_colors': 2, 'bilateral_d': 5,
            'sigma_color': 30, 'sigma_space': 30, 'block_size': 15,
            'threshold_c': 5, 'close_iters': 1, 'despeckle': 5,
            'median_k': 3, 'smooth_passes': 1,
        }
        for k, val in defaults.items(): self.v[k].set(val)
        self.v['mode'].set('bw')
        self.v['normalize_bg'].set(False)
        self.v['show_grid'].set(False)
        self.v['invert'].set(False)

    def _set_status(self, text, kind='info'):
        self.status_lbl.config(text=f'  {text}')

def main():
    try:
        from ctypes import windll
        windll.shcore.SetProcessDpiAwareness(1)
    except Exception: pass
    root = tk.Tk()
    try: root.iconname('Textile Pixelizer')
    except Exception: pass
    app = TextilePixelizer(root)
    root.mainloop()

if __name__ == '__main__':
    main()
