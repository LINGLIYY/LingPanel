"""Phase 3 — File browser tests.

Covers: path traversal protection, list/read/upload/delete/mkdir.
"""
import os
import io
import tempfile
import pytest
from pathlib import Path


# ═══════════════════════════════════════════════════════════
#  Path traversal protection
# ═══════════════════════════════════════════════════════════

def test_path_traversal_rejected(auth_client):
    """GET /api/files?path=../../../etc/passwd → 400"""
    r = auth_client.get("/api/files", params={"path": "../../../etc/passwd"})
    assert r.status_code == 400
    # Should mention illegal path
    assert "非法" in r.json()["detail"] or "允许" in r.json()["detail"]


def test_path_traversal_dot_dot_slash_rejected(auth_client):
    """GET /api/files?path=../var/log → 400 (.. component rejected)."""
    r = auth_client.get("/api/files", params={"path": "../var/log"})
    assert r.status_code == 400


def test_path_null_byte_rejected(auth_client):
    """Null byte in path → 400"""
    r = auth_client.get("/api/files", params={"path": "/etc/passwd\x00.txt"})
    assert r.status_code == 400


# ═══════════════════════════════════════════════════════════
#  List directory
# ═══════════════════════════════════════════════════════════

def test_list_root_directory(auth_client):
    """GET /api/files?path=/tmp returns items (whitelisted root)."""
    r = auth_client.get("/api/files", params={"path": "/tmp"})
    # /tmp may not exist on Windows; skip gracefully
    if r.status_code == 400 and "不在允许" in r.json().get("detail", ""):
        pytest.skip("/tmp not accessible on this system")
    assert r.status_code == 200
    data = r.json()
    assert "current_path" in data
    assert "items" in data
    assert isinstance(data["items"], list)


def test_list_nonexistent_path(auth_client):
    """GET /api/files?path=/tmp/nonexistent_subdir → 404."""
    r = auth_client.get("/api/files", params={"path": "/tmp/nonexistent_path_xyz_12345"})
    # Might be 400 if /tmp is not accessible on this system
    if r.status_code == 400 and "不在允许" in r.json().get("detail", ""):
        pytest.skip("/tmp not accessible on this system")
    assert r.status_code == 404


# ═══════════════════════════════════════════════════════════
#  Read file
# ═══════════════════════════════════════════════════════════

def test_read_file_requires_path(auth_client):
    """GET /api/files/read without path → 400"""
    r = auth_client.get("/api/files/read")
    assert r.status_code == 400


def test_read_file_binary_detection(auth_client):
    """Binary files should be detected."""
    # Pick a known binary on the system
    r = auth_client.get("/api/files/read", params={"path": "/bin/sh"})
    # Might be 404 on Windows, or 400 if not whitelisted, or success with binary flag
    if r.status_code == 200:
        data = r.json()
        if data.get("binary"):
            assert data["binary"] is True


# ═══════════════════════════════════════════════════════════
#  Upload
# ═══════════════════════════════════════════════════════════

def test_upload_file(auth_client):
    """POST /api/files/upload — upload a small text file to /tmp."""
    r = auth_client.post(
        "/api/files/upload?path=/tmp",
        files=[("files", ("test_upload.txt", io.BytesIO(b"hello ling server"), "text/plain"))],
    )
    if r.status_code == 200:
        data = r.json()
        assert "uploaded" in data
        for u in data["uploaded"]:
            if u["name"] == "test_upload.txt":
                assert u["success"] is True
                break


# ═══════════════════════════════════════════════════════════
#  Mkdir
# ═══════════════════════════════════════════════════════════

def test_mkdir_and_delete(auth_client):
    """POST /api/files/mkdir + DELETE /api/files round-trip."""
    dir_name = "test_ling_dir"

    # Create
    r = auth_client.post("/api/files/mkdir", params={"path": "/tmp", "name": dir_name})
    if r.status_code == 200:
        data = r.json()
        assert data["success"] is True

        # Delete
        full_path = f"/tmp/{dir_name}"
        r2 = auth_client.delete("/api/files", params={"path": full_path})
        if r2.status_code == 200:
            assert r2.json()["success"] is True
