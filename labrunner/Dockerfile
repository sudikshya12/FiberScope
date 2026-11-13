# OPTIONAL, EXPERIMENTAL: privileged lab runner. Prefer running it directly in a dedicated Linux VM.
FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends iproute2 iputils-ping iperf3 && rm -rf /var/lib/apt/lists/*
COPY fiberscope_labrunner.py /opt/fiberscope/fiberscope_labrunner.py
COPY entrypoint.sh /opt/fiberscope/entrypoint.sh
ENTRYPOINT ["/bin/sh", "/opt/fiberscope/entrypoint.sh"]
