export type Lang = "th" | "en";

const th = {
  // ─── Navigation ───────────────────────────────────────
  nav_dashboard: "Dashboard",
  nav_reports: "รายงานประจำเดือน",
  nav_tickets: "แจ้งปัญหา",
  nav_documents: "เอกสาร",
  nav_settings: "ตั้งค่า",
  nav_overview: "ภาพรวม",
  nav_clients: "ลูกค้า",
  nav_admin_reports: "รายงาน",
  nav_all_tickets: "Tickets ทั้งหมด",
  nav_logout: "ออกจากระบบ",

  // ─── Topbar ────────────────────────────────────────────
  topbar_notifications: "การแจ้งเตือน",
  topbar_mark_all_read: "อ่านทั้งหมด",
  topbar_no_notifications: "ไม่มีการแจ้งเตือน",
  topbar_account_settings: "ตั้งค่าบัญชี",
  topbar_logout: "ออกจากระบบ",

  // ─── Common ────────────────────────────────────────────
  back: "← กลับ",
  save: "บันทึก",
  cancel: "ยกเลิก",
  send: "ส่ง",
  items: "รายการ",
  not_set: "ยังไม่ได้ตั้งค่า",
  view_all: "ดูทั้งหมด →",

  // ─── Ticket status ────────────────────────────────────
  status_open: "เปิด",
  status_in_progress: "กำลังดำเนิน",
  status_waiting: "รอข้อมูล",
  status_resolved: "เสร็จสิ้น",
  status_closed: "ปิด",

  // ─── Ticket priority ──────────────────────────────────
  priority_low: "ต่ำ",
  priority_medium: "กลาง",
  priority_high: "สูง",
  priority_urgent: "เร่งด่วน",

  // ─── Dashboard ────────────────────────────────────────
  dash_greeting_prefix: "สวัสดี,",
  dash_subtitle: "ภาพรวมการดูแลเว็บไซต์ของคุณ",
  dash_completed_tasks: "งานเสร็จเดือนนี้",
  dash_uptime_label: "Uptime (30 วัน)",
  dash_open_tickets: "Tickets เปิดอยู่",
  dash_recent_activity: "กิจกรรมล่าสุด",
  dash_no_activity: "ยังไม่มีกิจกรรม",
  dash_quick_actions: "Quick Actions",
  dash_new_request: "+ แจ้งงานใหม่",
  dash_view_latest_report: "📄 ดู Report ล่าสุด",
  dash_contact_team: "💬 ติดต่อทีม",
  dash_website_status: "Website Status",
  dash_status_label: "สถานะ",
  dash_unknown: "ไม่ทราบ",
  dash_uptime_30d: "Uptime 30 วัน",
  dash_ssl_cert: "SSL Certificate",
  dash_domain_expiry: "Domain Expiry",
  dash_no_website: "ยังไม่มีข้อมูลเว็บไซต์",
  dash_impersonate_notice: "You are impersonating a client session.",
  dash_return_admin: "Return to admin",
  dash_default_client: "ลูกค้า",

  // ─── Tickets Index ────────────────────────────────────
  tickets_title: "แจ้งปัญหา",
  tickets_subtitle: "ติดตามและจัดการคำร้องทั้งหมดของคุณ",
  tickets_new_btn: "+ แจ้งปัญหาใหม่",
  tickets_filter_all: "ทั้งหมด",
  tickets_filter_open: "เปิด",
  tickets_filter_in_progress: "กำลังดำเนิน",
  tickets_filter_resolved: "เสร็จสิ้น",
  tickets_empty: "ไม่พบรายการแจ้งปัญหา",

  // ─── New Ticket ───────────────────────────────────────
  new_ticket_title: "แจ้งปัญหาใหม่",
  new_ticket_subtitle: "ส่งหัวข้อและรายละเอียดเพื่อแจ้งทีมงาน",
  field_subject: "หัวข้อ",
  field_description: "รายละเอียด",
  field_priority: "ความสำคัญ",
  ph_subject: "เช่น เว็บไซต์ไม่สามารถเข้าถึงได้",
  ph_description: "อธิบายปัญหาหรือสิ่งที่ต้องการให้ทีมดำเนินการ...",
  btn_submit_ticket: "ส่งคำร้อง",

  // ─── Ticket Detail ────────────────────────────────────
  ticket_created_at: "สร้างเมื่อ",
  ticket_status_label: "สถานะ",
  ticket_priority_label: "ความสำคัญ",
  ticket_opened_at: "เปิดเมื่อ",
  ticket_reply_label: "ตอบกลับ",
  ticket_ph_reply: "พิมพ์ข้อความ...",
  btn_send_message: "ส่งข้อความ",

  // ─── Reports ──────────────────────────────────────────
  reports_title: "รายงานประจำเดือน",
  reports_subtitle: "สรุปงานที่ทีมดำเนินการในแต่ละเดือน",
  reports_no_reports: "ยังไม่มีรายงาน",
  reports_total_tasks: "งานทั้งหมด",
  reports_uptime: "Uptime",
  reports_speed: "Speed Score",
  reports_tasks_list: "งานที่ดำเนินการ",
  reports_no_tasks: "ไม่มีรายการงาน",
  btn_export_pdf: "📥 Export PDF",
  cat_maintenance: "Maintenance",
  cat_development: "Development",
  cat_security: "Security",
  cat_seo: "SEO",
  cat_performance: "Performance",
  cat_other: "อื่นๆ",

  // ─── Documents ────────────────────────────────────────
  docs_title: "Documents",
  docs_subtitle: "เอกสารและรายงานของคุณ",
  docs_monthly_reports: "รายงานประจำเดือน",
  docs_no_docs_title: "ยังไม่มีเอกสาร",
  docs_no_docs_subtitle: "ทีมจะเผยแพร่รายงานหลังสิ้นสุดแต่ละเดือน",
  docs_view_report: "ดูรายงาน",
  docs_tasks_suffix: "งาน",
  docs_about_title: "เกี่ยวกับเอกสาร",
  docs_about_body: "รายงานประจำเดือนสรุปงานที่ทีม DoAction ดำเนินการให้คุณในแต่ละเดือน คุณสามารถดูรายละเอียดหรือ Export เป็น PDF ได้ หากต้องการเอกสารเพิ่มเติม กรุณา",
  docs_contact_link: "แจ้งทีมงาน",

  // ─── Settings ─────────────────────────────────────────
  settings_title: "Settings",
  settings_subtitle: "ตั้งค่าบัญชีของคุณ",
  settings_profile_section: "ข้อมูลโปรไฟล์",
  settings_name_label: "ชื่อ",
  settings_email_label: "อีเมล",
  settings_email_note: "อีเมลไม่สามารถเปลี่ยนได้ กรุณาติดต่อทีมงาน",
  settings_company_section: "ข้อมูลบริษัท",
  settings_company_name: "ชื่อบริษัท",
  settings_package_label: "แพ็กเกจ",
  settings_website_label: "เว็บไซต์",
  settings_contract_end: "สิ้นสุดสัญญา",
  settings_company_edit_note: "หากต้องการแก้ไขข้อมูลบริษัท กรุณาติดต่อทีมงาน DoAction",
  settings_help_section: "ต้องการความช่วยเหลือ?",
  settings_help_ticket: "🎫 แจ้งปัญหาผ่าน Support Ticket",
};

const en: Record<keyof typeof th, string> = {
  // ─── Navigation ───────────────────────────────────────
  nav_dashboard: "Dashboard",
  nav_reports: "Monthly Reports",
  nav_tickets: "Support Tickets",
  nav_documents: "Documents",
  nav_settings: "Settings",
  nav_overview: "Overview",
  nav_clients: "Clients",
  nav_admin_reports: "Reports",
  nav_all_tickets: "All Tickets",
  nav_logout: "Logout",

  // ─── Topbar ────────────────────────────────────────────
  topbar_notifications: "Notifications",
  topbar_mark_all_read: "Mark all read",
  topbar_no_notifications: "No notifications",
  topbar_account_settings: "Account settings",
  topbar_logout: "Logout",

  // ─── Common ────────────────────────────────────────────
  back: "← Back",
  save: "Save",
  cancel: "Cancel",
  send: "Send",
  items: "items",
  not_set: "Not set",
  view_all: "View all →",

  // ─── Ticket status ────────────────────────────────────
  status_open: "Open",
  status_in_progress: "In Progress",
  status_waiting: "Waiting",
  status_resolved: "Resolved",
  status_closed: "Closed",

  // ─── Ticket priority ──────────────────────────────────
  priority_low: "Low",
  priority_medium: "Medium",
  priority_high: "High",
  priority_urgent: "Urgent",

  // ─── Dashboard ────────────────────────────────────────
  dash_greeting_prefix: "Hello,",
  dash_subtitle: "Your website maintenance overview",
  dash_completed_tasks: "Tasks this month",
  dash_uptime_label: "Uptime (30 days)",
  dash_open_tickets: "Open Tickets",
  dash_recent_activity: "Recent Activity",
  dash_no_activity: "No activity yet",
  dash_quick_actions: "Quick Actions",
  dash_new_request: "+ New request",
  dash_view_latest_report: "📄 View latest report",
  dash_contact_team: "💬 Contact team",
  dash_website_status: "Website Status",
  dash_status_label: "Status",
  dash_unknown: "Unknown",
  dash_uptime_30d: "Uptime 30 days",
  dash_ssl_cert: "SSL Certificate",
  dash_domain_expiry: "Domain Expiry",
  dash_no_website: "No website info yet",
  dash_impersonate_notice: "You are impersonating a client session.",
  dash_return_admin: "Return to admin",
  dash_default_client: "Client",

  // ─── Tickets Index ────────────────────────────────────
  tickets_title: "Support Tickets",
  tickets_subtitle: "Track and manage all your requests",
  tickets_new_btn: "+ New Ticket",
  tickets_filter_all: "All",
  tickets_filter_open: "Open",
  tickets_filter_in_progress: "In Progress",
  tickets_filter_resolved: "Resolved",
  tickets_empty: "No tickets found",

  // ─── New Ticket ───────────────────────────────────────
  new_ticket_title: "New Support Ticket",
  new_ticket_subtitle: "Submit a subject and details to notify our team",
  field_subject: "Subject",
  field_description: "Description",
  field_priority: "Priority",
  ph_subject: "e.g. Website is not accessible",
  ph_description: "Describe the issue or what you need the team to do...",
  btn_submit_ticket: "Submit",

  // ─── Ticket Detail ────────────────────────────────────
  ticket_created_at: "Created",
  ticket_status_label: "Status",
  ticket_priority_label: "Priority",
  ticket_opened_at: "Opened",
  ticket_reply_label: "Reply",
  ticket_ph_reply: "Type a message...",
  btn_send_message: "Send",

  // ─── Reports ──────────────────────────────────────────
  reports_title: "Monthly Reports",
  reports_subtitle: "Summary of work done each month",
  reports_no_reports: "No reports yet",
  reports_total_tasks: "Total tasks",
  reports_uptime: "Uptime",
  reports_speed: "Speed Score",
  reports_tasks_list: "Tasks completed",
  reports_no_tasks: "No tasks",
  btn_export_pdf: "📥 Export PDF",
  cat_maintenance: "Maintenance",
  cat_development: "Development",
  cat_security: "Security",
  cat_seo: "SEO",
  cat_performance: "Performance",
  cat_other: "Other",

  // ─── Documents ────────────────────────────────────────
  docs_title: "Documents",
  docs_subtitle: "Your documents and reports",
  docs_monthly_reports: "Monthly Reports",
  docs_no_docs_title: "No documents yet",
  docs_no_docs_subtitle: "The team will publish reports at the end of each month",
  docs_view_report: "View report",
  docs_tasks_suffix: "tasks",
  docs_about_title: "About documents",
  docs_about_body: "Monthly reports summarize the work DoAction did for you each month. You can view the details or export as PDF. For additional documents, please",
  docs_contact_link: "contact our team",

  // ─── Settings ─────────────────────────────────────────
  settings_title: "Settings",
  settings_subtitle: "Manage your account settings",
  settings_profile_section: "Profile",
  settings_name_label: "Name",
  settings_email_label: "Email",
  settings_email_note: "Email cannot be changed. Please contact our team.",
  settings_company_section: "Company Info",
  settings_company_name: "Company name",
  settings_package_label: "Package",
  settings_website_label: "Website",
  settings_contract_end: "Contract end",
  settings_company_edit_note: "To edit company information, please contact the DoAction team.",
  settings_help_section: "Need help?",
  settings_help_ticket: "🎫 Submit a support ticket",
};

export const translations: Record<Lang, typeof th> = { th, en };
export type Translations = typeof th;
export type TranslationKey = keyof Translations;
