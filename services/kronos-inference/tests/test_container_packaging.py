from pathlib import Path


DOCKERFILE = Path(__file__).parents[1] / "Dockerfile"


def test_runtime_pythonpath_includes_app_and_vendored_model() -> None:
    text = DOCKERFILE.read_text()
    pythonpath_line = next(
        line for line in text.splitlines() if line.startswith("ENV PYTHONPATH=")
    )

    assert "/app/src" in pythonpath_line
    assert "/app/third_party/kronos" in pythonpath_line


def test_cpu_pytorch_index_has_priority_without_unsafe_resolution() -> None:
    text = DOCKERFILE.read_text()
    install_line = next(
        line for line in text.splitlines() if line.startswith("RUN uv pip install")
    )

    assert "--index https://download.pytorch.org/whl/cpu" in install_line
    assert "--default-index https://pypi.org/simple" in install_line
    assert "unsafe-best-match" not in text
