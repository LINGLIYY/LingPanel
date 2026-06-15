"""Shared utility functions used across the server package."""


def fmt_size(n: int) -> str:
    """Format a byte count as a human-readable string (B, KB, MB, GB, TB)."""
    for u in ["B", "KB", "MB", "GB"]:
        if n < 1024:
            return f"{n:.1f} {u}"
        n /= 1024
    return f"{n:.1f} TB"
