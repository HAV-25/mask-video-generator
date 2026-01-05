const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs').promises;
const path = require('path');

const execAsync = promisify(exec);
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'mask-video-generator' });
});

// Main endpoint
app.post('/create-mask-video', async (req, res) => {
  try {
    const { video_width, video_height, video_duration_sec, mask_y_start, mask_y_end } = req.body;
    
    // Validate inputs
    if (!video_width || !video_height || !video_duration_sec || !mask_y_start || !mask_y_end) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    console.log('Creating mask video:', { video_width, video_height, video_duration_sec, mask_y_start, mask_y_end });

    const mask_height = mask_y_end - mask_y_start;
    const filename = `mask_${Date.now()}.mp4`;
    const outputPath = `/tmp/${filename}`;

    // FFmpeg command to create mask video
    const ffmpegCmd = `ffmpeg -f lavfi -i color=c=black:s=${video_width}x${video_height}:d=${video_duration_sec} \
     -vf "drawbox=y=${mask_y_start}:color=white@1:width=${video_width}:height=${mask_height}:t=fill" \
     -r 30 -pix_fmt yuv420p -threads 2 -preset ultrafast -crf 28 ${outputPath}`;

    console.log('Executing FFmpeg command...');
    await execAsync(ffmpegCmd);
    console.log('Mask video created successfully');

    // Read the file
    const videoBuffer = await fs.readFile(outputPath);
    const fileSize = videoBuffer.length;

    // Upload to Supabase Storage
    console.log('Uploading to Supabase Storage...');
    const { data, error } = await supabase.storage
      .from('Humanlyreal-Mask-Videos')
      .upload(filename, videoBuffer, {
        contentType: 'video/mp4',
        upsert: false
      });

    if (error) throw error;

    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from('Humanlyreal-Mask-Videos')
      .getPublicUrl(filename);

    // Cleanup temp file
    await fs.unlink(outputPath);

    console.log('Mask video uploaded:', publicUrl);

    res.json({
      success: true,
      mask_video_url: publicUrl,
      file_size_mb: (fileSize / (1024 * 1024)).toFixed(2),
      duration_sec: video_duration_sec,
      dimensions: `${video_width}x${video_height}`
    });

  } catch (error) {
    console.error('Error creating mask video:', error);
    res.status(500).json({ 
      error: 'Failed to create mask video', 
      details: error.message 
    });
  }
});

app.listen(PORT, () => {
  console.log(`Mask video generator running on port ${PORT}`);
});
