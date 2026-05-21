const express = require('express');
const multer = require('multer');
const archiver = require('archiver');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 5001;

app.use(cors());
app.use(express.json());

const upload = multer({ dest: 'uploads/' });

app.post('/create-zip', (req, res) => {
    const { files } = req.body;

    if (!files || !Array.isArray(files)) {
        return res.status(400).send("Invalid input format.");
    }

    const tempId = Date.now().toString() + '-' + Math.round(Math.random() * 10000);
    const tempDir = path.join(__dirname, 'output', `temp-${tempId}`);
    const zipFilePath = path.join(__dirname, 'output', `project-${tempId}.zip`);
    
    // Ensure output directory exists
    fs.mkdirSync(path.join(__dirname, 'output'), { recursive: true });
    
    const output = fs.createWriteStream(zipFilePath);
    const archive = archiver('zip');

    output.on('close', () => {
        res.download(zipFilePath, 'project.zip', (err) => {
            if (err) console.error(err);
            // Cleanup zip
            try {
                if (fs.existsSync(zipFilePath)) fs.unlinkSync(zipFilePath);
            } catch (e) { console.error("Error cleaning up zip", e); }
            
            // Cleanup temp dir
            try {
                if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
            } catch (e) { console.error("Error cleaning up temp dir", e); }
        });
    });

    archive.on('error', (err) => {
        res.status(500).send({ error: err.message });
    });

    archive.pipe(output);

    try {
        files.forEach(file => {
            if (!file.path) return;
            
            // Safe path resolution inside tempDir
            const safeRelativePath = path.normalize(file.path).replace(/^(\.\.(\/|\\|$))+/, '');
            const filePath = path.join(tempDir, safeRelativePath);

            // Create folder if needed
            fs.mkdirSync(path.dirname(filePath), { recursive: true });

            fs.writeFileSync(filePath, file.content || '');
            archive.file(filePath, { name: safeRelativePath });
        });

        archive.finalize();
    } catch (err) {
        console.error("Error creating files:", err);
        try {
            if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
        } catch (e) {}
        if (!res.headersSent) res.status(500).send({ error: "Failed to create files" });
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
