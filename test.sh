#!/bin/bash
# Copyright 2026 Google LLC.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

echo "Testing /api/analyze route with test_data/test.mp4..."
echo "Please make sure your Next.js server is running on http://localhost:3000 in another terminal."
echo "This endpoint runs the full pipeline: Video Intelligence -> Enhance -> Gemini Assembly"

# Provide a sample prompt similar to what the UI might send
PROMPT="Analyze this video and identify distinct scenes. For each scene, describe the visual content, any text visible on screen, and the spoken words."
MODEL="gemini-3.1-pro-preview"

curl -s -X POST http://localhost:3000/api/analyze \
  -F "file=@test_data/test.mp4;type=video/mp4" \
  -F "prompt=$PROMPT" \
  -F "model=$MODEL" \
  -o analyze_result_tmp.json

echo ""
if [ -s analyze_result_tmp.json ]; then
  # Use python to format the JSON to avoid any shell interpretation bugs
  if python3 -c 'import sys, json; print(json.dumps(json.load(sys.stdin), indent=4))' < analyze_result_tmp.json > analyze_result.json; then
    rm analyze_result_tmp.json
    echo "Done! Result saved to analyze_result.json."
    echo "Here is a preview of the final analysis output:"
    head -n 50 analyze_result.json
  else
    echo "Error formatting JSON. The raw response was:"
    cat analyze_result_tmp.json
    mv analyze_result_tmp.json analyze_result.json
  fi
else
  echo "Error: analyze_result_tmp.json is empty or was not created."
  echo "Check your Next.js server logs for any errors."
fi
