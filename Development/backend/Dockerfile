# Use Python 3.10 slim as base image (optimized for HF Spaces)
FROM python:3.10-slim

# Set working directory to /code
WORKDIR /code

# HF Spaces specific user setup
# HF Spaces requires running as a non-root user
RUN useradd -m -u 1000 user
USER user
ENV PATH="/home/user/.local/bin:$PATH"

# Install system dependencies
# libsndfile1 is required by soundfile for audio processing
# ffmpeg is often required by librosa and underlying audio pipelines
USER root
RUN apt-get update && apt-get install -y \
    libsndfile1 \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*
USER user

# Copy requirements file explicitly
COPY --chown=user requirements.txt /code/requirements.txt

# Install Python dependencies
# Set pip caching directory
ENV PIP_CACHE_DIR=/home/user/.cache/pip
RUN pip install --no-cache-dir --upgrade -r /code/requirements.txt

# Copy everything else into the container
COPY --chown=user . /code

# Create cache directory for Hugging Face models so they don't block root
ENV HF_HOME=/home/user/.cache/huggingface
RUN mkdir -p /home/user/.cache/huggingface

# Expose port (HF Spaces defaults to 7860)
EXPOSE 7860

# Command to run the application using uvicorn
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "7860"]
