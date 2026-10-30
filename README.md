> [!WARNING]
> **Under Development**
> This repository is a work in progress. Features and code are subject to frequent updates and changes.
<div align="center">

# Nen

A modern, ultra-fast file explorer for Windows built with GPUI.

</div>

## Scope

Nen is an ultra-fast, keyboard-driven file explorer for Windows designed to be lightweight, instantaneous, and GPU-accelerated.

On Windows, managing files usually forces you to choose between the sluggish, bloat-heavy native Explorer—plagued with UI freezes on large folders, delayed loading, and cluttered ribbons—or third-party alternatives built on Electron, WebViews, or heavy WinUI runtimes that consume hundreds of megabytes of RAM just to view a directory. Nen eliminates this friction with a unified, keyboard-first workflow built around an instant Quick Access command search and virtualized file listings, allowing you to jump between paths, filter thousands of items, and execute file operations with zero input latency.

Because it is written in Rust and powered by GPUI, it renders directly through the GPU at 120+ FPS with near-instant cold startup and minimal RAM consumption, completely avoiding the runtime overhead of web technologies, heavy UI frameworks, and blocking disk I/O.

## Development

### Prerequisites

- **Windows 10 / 11** (64-bit)
- **[Rust](https://rustup.rs/)** (Rust 1.85+ with 2024 edition support)
- **[Bun](https://bun.com/)**
- **Visual Studio C++ Build Tools** (MSVC toolchain for Windows linking)
- **[Git](https://git-scm.com/)**

Make sure your Rust toolchain is up to date:

### Getting Started

1. **Clone the repository:**
   ```powershell
   git clone https://github.com/moiCR/Nen.git
   cd Nen
   ```

2. **Build and run for production:**
   ```powershell
   bun tauri dev
   ```

### Code Quality & Standards

Before submitting changes, ensure everything is formatted and lint-free:

## Acknowledgements

- **[GPUI](https://github.com/zed-industries/zed)** – The high-performance, GPU-accelerated UI framework developed by [Zed Industries](https://zed.dev).
- **[gpui-kit](https://github.com/longbridge/gpui-kit)** – Modern UI components and utilities for GPUI by Longbridge.
- **[File Pilot](https://filepilot.tech/)** – Workflow and UX inspiration for an ultra-fast, keyboard-driven file manager.
- **[Lucide Icons](https://lucide.dev/)** – Minimalist iconography.
