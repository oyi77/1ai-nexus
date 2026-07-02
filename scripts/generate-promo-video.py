#!/usr/bin/env python3
"""
Generate promotional video using Replicate API
Uses video-gen skill prompt engineering formula:
[Subject] + [Action] + [Camera] + [Style] + [Mood]
"""
import requests
import time
import sys
import os

API_TOKEN = os.environ.get("REPLICATE_API_TOKEN", "")
OUTPUT_DIR = "/home/openclaw/projects/1ai-tracker/public"

# AnimateDiff version ID
ANIMATEDIFF_VERSION = "beecf59c4aee8d81bf04f0381033dfa10dc16e845b4ae00d281e2fa377e48a9f"

# Prompt engineering from video-gen skill: [Subject] + [Action] + [Camera] + [Style] + [Mood]
PROMPT = (
    "Futuristic cryptocurrency trading command center with holographic displays, "
    "animated green candlestick charts rising with golden light trails, "
    "slow dolly zoom into the main dashboard, "
    "cinematic 4K quality, teal and cyan neon glow against dark background, "
    "film grain, dramatic lighting with volumetric fog, "
    "futuristic high-tech aesthetic, professional fintech presentation, "
    "data streams flowing between screens, trading signals appearing as holographic arrows"
)

NEGATIVE_PROMPT = "no watermarks, no subtitles, no text overlays, no blur, no artifacts, no distortion, no people, no faces"

def generate_video():
    print("=" * 60)
    print("NEXUS ALPHA ENGINE - PROMOTIONAL VIDEO GENERATOR")
    print("Using Replicate + AnimateDiff + video-gen skill prompts")
    print("=" * 60)
    print(f"\nPrompt: {PROMPT[:100]}...")
    print(f"Negative: {NEGATIVE_PROMPT}")
    print()
    
    # Create prediction
    print("Creating prediction...")
    response = requests.post(
        "https://api.replicate.com/v1/predictions",
        headers={
            "Authorization": f"Bearer {API_TOKEN}",
            "Content-Type": "application/json",
        },
        json={
            "version": ANIMATEDIFF_VERSION,
            "input": {
                "prompt": PROMPT,
                "n_prompt": NEGATIVE_PROMPT,
            }
        }
    )
    
    if response.status_code != 201:
        print(f"Error: {response.status_code}")
        print(response.text)
        return False
    
    prediction = response.json()
    prediction_id = prediction["id"]
    print(f"Prediction ID: {prediction_id}")
    print(f"Status: {prediction['status']}")
    
    # Poll for completion
    print("\nWaiting for video generation...")
    max_wait = 300  # 5 minutes max
    start_time = time.time()
    
    while True:
        elapsed = time.time() - start_time
        if elapsed > max_wait:
            print(f"\n❌ Timeout after {max_wait}s")
            return False
        
        time.sleep(10)
        
        status_response = requests.get(
            f"https://api.replicate.com/v1/predictions/{prediction_id}",
            headers={"Authorization": f"Bearer {API_TOKEN}"}
        )
        status = status_response.json()
        
        if status["status"] == "succeeded":
            print(f"\n✅ Video generated successfully!")
            output = status["output"]
            print(f"Output URL: {output}")
            
            # Download video
            print(f"\nDownloading video...")
            video_response = requests.get(output, stream=True)
            output_path = f"{OUTPUT_DIR}/promo-video-real.mp4"
            
            with open(output_path, 'wb') as f:
                for chunk in video_response.iter_content(chunk_size=8192):
                    f.write(chunk)
            
            print(f"✅ Saved to: {output_path}")
            return True
            
        elif status["status"] == "failed":
            print(f"\n❌ Generation failed: {status.get('error', 'Unknown error')}")
            return False
        else:
            print(f"  ⏳ {status['status']}... ({int(elapsed)}s elapsed)")

if __name__ == "__main__":
    success = generate_video()
    if success:
        print("\n" + "=" * 60)
        print("DONE! Video saved to public/promo-video-real.mp4")
        print("=" * 60)
    else:
        print("\nFailed to generate video")
        sys.exit(1)
