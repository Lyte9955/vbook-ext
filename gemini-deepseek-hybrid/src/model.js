function execute() {
    return Response.success([
        {
            id: "gemini-3.5-flash-lite",
            name: "Gemini 3.5 Flash-Lite (Khuyên dùng Free Tier)",
            description: "Mặc định; ~15 RPM & ~500 RPD/project, tối ưu riêng cho dịch thuật khối lượng lớn",
            isNetworkRequired: true
        },
        {
            id: "gemini-3.1-flash-lite",
            name: "Gemini 3.1 Flash-Lite",
            description: "Hạn mức lớn (~15 RPM & ~500 RPD/project), độc lập hạn mức với 3.5 Flash-Lite",
            isNetworkRequired: true
        },
        {
            id: "gemini-3.8-flash",
            name: "Gemini 3.8 Flash",
            description: "Văn phong mượt hơn Flash-Lite; Free Tier ~5 RPM & ~20 RPD/project (nên bật tự chuyển model)",
            isNetworkRequired: true
        },
        {
            id: "gemini-3.6-flash",
            name: "Gemini 3.6 Flash",
            description: "Flash ổn định thế hệ trước (~5 RPM & ~20 RPD/project), độc lập hạn mức với 3.8 Flash",
            isNetworkRequired: true
        },
        {
            id: "gemini-4-hydrogen",
            name: "Gemini 4 Hydrogen",
            description: "Model Gemini 4 đa năng có hỗ trợ Free Tier, văn phong & ngữ cảnh xuất sắc",
            isNetworkRequired: true
        },
        {
            id: "gemini-2.5-flash-lite",
            name: "Gemini 2.5 Flash-Lite (Project cũ)",
            description: "Chỉ dành cho project cũ đã từng gọi dòng 2.5 (project mới có thể báo 404)",
            isNetworkRequired: true
        }
    ]);
}
