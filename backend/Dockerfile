FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

RUN python -m pip install --no-cache-dir --upgrade pip

COPY backend/requirements.txt backend/requirements-onnx.txt backend/requirements-paddle.txt /app/backend/
RUN python -m pip install --no-cache-dir -r /app/backend/requirements-onnx.txt -r /app/backend/requirements-paddle.txt

COPY backend /app/backend

EXPOSE 8000

CMD ["python", "-m", "uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "8000"]
