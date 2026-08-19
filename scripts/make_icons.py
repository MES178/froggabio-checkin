#!/usr/bin/env python3
"""Generate the PWA icons (no image libraries needed).

A FroggaBio-green tile with three white QR finder patterns — recognisable as a
scanner on a home screen at 48px.

Usage: python3 scripts/make_icons.py
"""
import os
import struct
import zlib

GREEN = (0x00, 0xAD, 0x02)
WHITE = (0xFF, 0xFF, 0xFF)
OUT_DIR = os.path.join(os.path.dirname(__file__), "..")


def png(width, height, pixels):
    """pixels: list of rows, each a list of (r,g,b) tuples."""
    raw = b"".join(b"\x00" + b"".join(bytes(px) for px in row) for row in pixels)
    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


def finder(size):
    """Coordinates of the three finder squares, as fractions of the tile."""
    unit = size / 9.0
    return [(unit, unit), (size - 4 * unit, unit), (unit, size - 4 * unit)], unit


def render(size):
    boxes, unit = finder(size)
    side = 3 * unit
    ring = max(1, round(unit * 0.42))
    rows = []
    for y in range(size):
        row = []
        for x in range(size):
            colour = GREEN
            for bx, by in boxes:
                if bx <= x < bx + side and by <= y < by + side:
                    inner = (
                        bx + ring <= x < bx + side - ring and by + ring <= y < by + side - ring
                    )
                    core = (
                        bx + 2 * ring <= x < bx + side - 2 * ring
                        and by + 2 * ring <= y < by + side - 2 * ring
                    )
                    colour = WHITE if (not inner or core) else GREEN
            row.append(colour)
        rows.append(row)
    return png(size, size, rows)


for px in (192, 512):
    path = os.path.join(OUT_DIR, f"icon-{px}.png")
    with open(path, "wb") as fh:
        fh.write(render(px))
    print(f"wrote {path} ({os.path.getsize(path)} bytes)")
