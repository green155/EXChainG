from __future__ import annotations

import sys
from pathlib import Path

# Tests import the ``bot`` package from the local-ai directory.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


import os

import pytest


@pytest.fixture(autouse=True)
def restore_environment():
    """``load_config`` seeds ``os.environ`` from the .env file; undo that."""
    snapshot = dict(os.environ)
    yield
    os.environ.clear()
    os.environ.update(snapshot)
