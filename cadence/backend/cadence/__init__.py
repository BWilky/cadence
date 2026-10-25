"""Cadence — a daily storyline for lights and music, running as a Home Assistant add-on."""

from importlib.metadata import PackageNotFoundError, version

try:
    # pyproject.toml is the single source of truth (the add-on image pip-installs the package).
    __version__ = version("cadence")
except PackageNotFoundError:  # running from a checkout without an install
    __version__ = "0.0.0-dev"
