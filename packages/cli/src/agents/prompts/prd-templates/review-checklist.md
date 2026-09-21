# PRD Review Checklist
<!-- Base — adapt từ chuẩn PRD review phổ biến. Team chỉnh theo văn hoá riêng. -->

## Nhóm Content Completeness

### 1. Problem Statement
- [ ] Có nêu rõ **ai** gặp vấn đề gì?
- [ ] Mức độ ảnh hưởng được mô tả?
- [ ] Có bằng chứng (từ meeting note/đối tác) hay chỉ là giả định?
- [ ] Gắn [[src:node_id]] cho mọi thông tin từ nguồn?

### 2. Goals & Success Metrics
- [ ] Mục tiêu có đo lường được (SMART)?
- [ ] Có baseline/target/thời điểm đo?
- [ ] Metric có thực tế, không quá tham vọng?

### 3. Scope & Out-of-scope
- [ ] Có tách rõ 2 phần này?
- [ ] Có phần nào đã bàn với đối tác nhưng PRD bỏ sót?
- [ ] Có phần nào PRD có mà chưa từng bàn với đối tác?

### 4. Requirements
- [ ] Mỗi yêu cầu có đủ chi tiết + acceptance criteria để dev triển khai?
- [ ] Có case nào bị bỏ sót (edge case, error handling)?
- [ ] Có đánh số REQ-xxx và phân priority P0/P1/P2?

### 5. Dependency & rủi ro kỹ thuật
- [ ] Có phụ thuộc hệ thống/đối tác nào chưa được nhắc tới?
- [ ] Rủi ro kỹ thuật có được xác nhận?

### 6. Launch plan/Timeline
- [ ] Có khớp cam kết đã nêu trong meeting note?
- [ ] Timeline có thực tế?

## Nhóm Quality

### 7. Ngôn ngữ mơ hồ
- [ ] Có câu nào dùng từ chung chung ("nhanh", "nhiều người dùng", "dễ dùng") thay vì số liệu cụ thể?
- [ ] Nếu không có số liệu, có đánh dấu "cần làm rõ"?

### 8. Mâu thuẫn nội bộ
- [ ] PRD có tự mâu thuẫn giữa các section?
- [ ] Có mâu thuẫn với Decisions trong project_memory.md?

### 9. Prioritization
- [ ] Có phân P0/P1/P2 rõ ràng?
- [ ] Có tình trạng "cái gì cũng P0"?
