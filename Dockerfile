FROM python:3.12-slim

WORKDIR /app

# Install deps first so the layer is cached when only code changes.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8501

# Default command runs the Streamlit dashboard.
# Override with `python pipeline.py` to run the ETL job instead.
CMD ["streamlit", "run", "app.py", "--server.port=8501", "--server.address=0.0.0.0"]