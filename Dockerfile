FROM python:3.12-alpine
WORKDIR /app
RUN pip install flask --no-cache-dir
COPY app.py db.py ./
COPY templates/ templates/
COPY static/ static/
EXPOSE 5000
# Restart the container if Flask stops serving (process alive but wedged).
# /manifest.json is unauthenticated + cheap, so it works even if basic auth is on.
# MUST use 127.0.0.1, not localhost: inside the container `localhost` can resolve
# to IPv6 ::1 first, but Flask's app.run(host="0.0.0.0") binds IPv4 only, so an
# IPv6 loopback connection is refused. Python stdlib (always in this image).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:5000/manifest.json', timeout=4)" || exit 1
CMD ["python", "app.py"]
