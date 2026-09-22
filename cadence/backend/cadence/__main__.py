from __future__ import annotations

import logging

import uvicorn

from .config import load_options


def main() -> None:
    opts = load_options()
    logging.basicConfig(
        level=getattr(logging, opts.log_level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
    )
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    uvicorn.run(
        "cadence.main:app",
        host="0.0.0.0",
        port=opts.port,
        log_level=opts.log_level,
        # Keep the raw peer address: ingress requests are recognised by the Supervisor proxy IP.
        proxy_headers=False,
    )


if __name__ == "__main__":
    main()
