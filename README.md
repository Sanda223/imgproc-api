# 📘 Image Processing API (CAB432 Assignment 1)

A REST API built with **Node.js + Express + TypeScript**, containerised with **Docker**, and deployable on **AWS EC2 via ECR**.  
This app demonstrates CPU-intensive image processing using [Sharp](https://sharp.pixelplumbing.com/) — resizing, blurring, and sharpening images up to 8K resolution — to sustain >80% CPU load.

---

## ✨ Features
- **REST API** with endpoints for auth, jobs, and images.  
- **JWT Authentication** (two hardcoded users: `alice` + `bob`).  
- **CPU-intensive image pipeline** using Sharp (resize + blur + sharpen).  
- **Two data types**:  
  - Unstructured → images (`.png`)  
  - Structured → job metadata (UUIDs in memory)  
- **Containerised with Docker** and ready for AWS deployment.  
- Includes a **load test script** to drive CPU >80%.  

---

## 🚀 Getting Started (Local Dev)

### 1. Install dependencies
```bash
npm install
```

### 2. Generate seed image
```bash
npx ts-node scripts/generate_seed.ts
```

### 3. Run the API (dev mode)
```bash
export JWT_SECRET=changeme
npm run dev
```
API will be available at: [http://localhost:3000](http://localhost:3000)

---

## 🔑 Authentication
Login with hardcoded credentials:

```bash
curl -X POST http://localhost:3000/v1/auth/login  -H "Content-Type: application/json"  -d '{"username":"alice","password":"password1"}'
```

Response:
```json
{ "token": "<JWT_TOKEN>" }
```

Use this token in all `Authorization` headers:
```
Authorization: Bearer <JWT_TOKEN>
```

---

## 🖼️ Example Job
Submit a CPU-heavy image job:

```bash
curl -X POST http://localhost:3000/v1/jobs  -H "Authorization: Bearer <JWT_TOKEN>"  -H "Content-Type: application/json"  -d '{
  "sourceId":"seed",
  "ops":[
    {"op":"resize","width":7680,"height":4320},
    {"op":"blur","sigma":10},
    {"op":"sharpen","sigma":2},
    {"op":"resize","width":7680,"height":4320}
  ]
}'
```

Response:
```json
{
  "id": "ea93a2fb-1984-42d9-a924-ff35f2955284",
  "output": {
    "imageId": "ea93a2fb-1984-42d9-a924-ff35f2955284",
    "url": "/v1/images/ea93a2fb-1984-42d9-a924-ff35f2955284"
  }
}
```

View the result:
```
http://localhost:3000/v1/images/ea93a2fb-1984-42d9-a924-ff35f2955284
```

---

## 📈 Load Testing
Hammer the API to prove >80% CPU:

```bash
export JWT=<YOUR_TOKEN>
npm run load:test
```

Optional parameters:
```bash
C=12 D=300 npm run load:test   # 12 workers for 5 minutes
```

Watch CPU usage with **Activity Monitor** (Mac) or `top`.

---

## 🐳 Docker

### Build
```bash
docker buildx build --platform linux/amd64 -t imgproc-api:0.1.0 .
```

### Run
```bash
docker run --rm --platform linux/amd64 -p 3000:3000  -e JWT_SECRET=$(openssl rand -hex 16)  imgproc-api:0.1.0
```

---

## ☁️ AWS Deployment (Summary)
1. Build & tag the image.  
2. Push to AWS ECR:
   ```bash
   aws ecr create-repository --repository-name imgproc-api
   aws ecr get-login-password --region ap-southeast-2    | docker login --username AWS --password-stdin <ACCOUNT_ID>.dkr.ecr.ap-southeast-2.amazonaws.com

   docker tag imgproc-api:0.1.0 <ACCOUNT_ID>.dkr.ecr.ap-southeast-2.amazonaws.com/imgproc-api:0.1.0
   docker push <ACCOUNT_ID>.dkr.ecr.ap-southeast-2.amazonaws.com/imgproc-api:0.1.0
   ```

3. On EC2 (Ubuntu 24.04), install Docker, then:
   ```bash
   sudo docker pull <ACCOUNT_ID>.dkr.ecr.ap-southeast-2.amazonaws.com/imgproc-api:0.1.0
   sudo docker run -d -p 80:3000 -e JWT_SECRET=$(openssl rand -hex 16) imgproc-api:0.1.0
   ```

4. Test via EC2 public DNS:
   ```
   http://<ec2-public-dns>/v1/auth/login
   ```

---

## 📂 Project Structure
```
src/
 ├── routes/          # Express routes (auth, jobs, images)
 ├── middleware/      # JWT auth, error handler
 ├── services/        # Sharp image pipeline
 ├── app.ts           # App setup
 └── server.ts        # Entrypoint

scripts/
 ├── generate_seed.ts # Writes seed.png to originals/
 └── load_test.ts     # Load generator

storage/
 ├── originals/       # Input images (seed.png)
 └── outputs/         # Job results

Dockerfile
.dockerignore
README.md
```

---

## 👥 Users
- `alice` / `password1`  
- `bob` / `password2`  

---

## 📜 License
For educational use (CAB432 assignment).  
