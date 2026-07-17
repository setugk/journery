FROM python:3.12-alpine
WORKDIR /app
RUN pip install flask --no-cache-dir
COPY app.py db.py ./
COPY templates/ templates/
COPY static/ static/
EXPOSE 5000
# Restart the container if Flask stops serving (process alive but wedged).
# /manifest.json is unauthenticated + cheap, so it works even if basic auth is on.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://localhost:5000/manifest.json || exit 1
CMD ["python", "app.py"]
