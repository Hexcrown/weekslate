FROM python:3.12-slim
WORKDIR /app
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ /app/backend/
COPY frontend/ /app/frontend/
ENV WEEKSLATE_DB=/data/weekslate.sqlite \
    WEEKSLATE_FRONTEND=/app/frontend \
    TZ=America/New_York
WORKDIR /app/backend
EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
