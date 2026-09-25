// Demo data.
//
// An empty ATS demonstrates nothing — you cannot judge a pipeline view with no
// pipeline in it. This seeds two departments, three jobs and six candidates
// with realistic resumes, then runs the real screening engine over them so the
// match percentages are genuinely computed rather than typed in.

import { db } from './db.js'
import { createDepartment } from '../services/departments.js'
import { createJob } from '../services/jobs.js'
import { ingestResume } from '../services/candidates.js'
import { createApplication, screenBatch, moveStage } from '../services/applications.js'
import { importFromPortal, applyToJob } from '../services/careers.js'

const RESUMES = [
  `Priya Sharma
priya.sharma@example.com | 9876543210 | Mumbai, Maharashtra
LinkedIn: https://linkedin.com/in/priyasharma

Working as Senior Software Engineer at Acme Systems
Total experience: 5 years
Current CTC: 12 LPA | Expected CTC: 18 LPA | Notice period: 30 days
Languages: English, Hindi, Marathi

SUMMARY
Backend engineer working across C#, ASP.NET Core and SQL Server. Owned the claims
intake service at Acme end to end — design, delivery and the on-call rota.

EXPERIENCE
Acme Systems — Senior Software Engineer (2022 - present)
- Built the claims intake service handling 40,000 submissions a day in ASP.NET Core.
- Cut p99 latency from 1400ms to 180ms by removing N+1 queries in Entity Framework
  and adding projection to the read path.
- Moved the deployment to Docker on Azure; wrote the CI/CD pipeline in Jenkins.
- Mentored two juniors through their first production incident.

Infotech Solutions — Software Engineer (2020 - 2022)
- REST APIs in .NET with SQL Server behind them.

SKILLS
C#, ASP.NET Core, Entity Framework, SQL Server, LINQ, Docker, Azure, REST, React, CI/CD

EDUCATION
B.E. Computer Engineering, Mumbai University, 2020`,

  `Rahul Verma
rahul.verma@example.com | 9823456710 | Pune, Maharashtra

Working as Software Engineer at Brightline Tech
Total experience: 2 years
Current CTC: 6 LPA | Expected CTC: 10 LPA | Notice period: 60 days
Languages: English, Hindi

EXPERIENCE
Brightline Tech — Software Engineer (2023 - present)
- Maintained internal tools written in C# and ASP.NET.
- Wrote stored procedures against SQL Server for the reporting module.
- Some exposure to Docker during a migration.

SKILLS
C#, ASP.NET, SQL Server, JavaScript, HTML, CSS

EDUCATION
B.Tech Information Technology, Pune University, 2023`,

  `Ananya Iyer
ananya.iyer@example.com | 9900112233 | Bengaluru, Karnataka
GitHub: https://github.com/ananyaiyer

Working as Lead Engineer at Northwind Cloud
Total experience: 8 years
Current CTC: 28 LPA | Expected CTC: 38 LPA | Notice period: 90 days
Languages: English, Tamil, Kannada

EXPERIENCE
Northwind Cloud — Lead Engineer (2021 - present)
- Led the platform team of six. Designed the multi-tenant billing service.
- Ran Kubernetes across three regions; wrote the Terraform that provisions it.
- Reduced infrastructure spend 34% by rightsizing and moving batch work to spot.

Cloudsmith — Senior Engineer (2018 - 2021)
- Python and FastAPI services behind a React front end. Kafka for the event bus.

SKILLS
Python, FastAPI, Go, Kubernetes, Docker, Terraform, AWS, Kafka, PostgreSQL,
System Design, Microservices, Team Leadership

EDUCATION
B.E. Computer Science, Anna University, 2017`,

  `Mohammed Farhan
farhan.m@example.com | 9765432100 | Hyderabad, Telangana

Working as Full Stack Developer at Vertex Labs
Total experience: 4 years
Current CTC: 11 LPA | Expected CTC: 16 LPA | Notice period: immediate
Languages: English, Hindi, Telugu

EXPERIENCE
Vertex Labs — Full Stack Developer (2022 - present)
- React and TypeScript on the front end, Node.js and Express behind it.
- Built the customer dashboard from scratch; 30,000 monthly active users.
- Migrated state management from Redux to a lighter store, cutting bundle size 40%.

Pixelworks — Frontend Developer (2021 - 2022)
- React, Redux, Tailwind.

SKILLS
JavaScript, TypeScript, React, Redux, Node.js, Express, MongoDB, REST, GraphQL,
Docker, HTML, CSS, Tailwind

EDUCATION
B.Sc Computer Science, Osmania University, 2021`,

  `Sneha Deshpande
sneha.d@example.com | 9812345678 | Mumbai, Maharashtra

Working as Business Development Manager at Horizon Insurance
Total experience: 6 years
Current CTC: 9 LPA | Expected CTC: 13 LPA | Notice period: 30 days
Languages: English, Hindi, Marathi, Gujarati

EXPERIENCE
Horizon Insurance — Business Development Manager (2021 - present)
- Owned the West region channel. Grew the agent network from 40 to 180.
- Beat target 7 of 8 quarters; best quarter 142% of plan.
- Ran Salesforce for the region and trained 20 field staff on it.

Sunrise Financial — Sales Executive (2019 - 2021)
- Cold calling, lead generation, closing. Consistent top-three performer.

SKILLS
Salesforce, CRM, Lead Generation, Cold Calling, Negotiation, Team Leadership,
Excel, Communication, Stakeholder Management

EDUCATION
MBA Marketing, Symbiosis Pune, 2019`,

  `Arjun Nair
arjun.nair@example.com | 9988776655 | Kochi, Kerala

Working as Sales Executive at Metro Retail
Total experience: 1.5 years
Current CTC: 3.5 LPA | Expected CTC: 6 LPA | Notice period: 15 days
Languages: English, Hindi, Malayalam

EXPERIENCE
Metro Retail — Sales Executive (2024 - present)
- Walk-in sales on the shop floor. Hit monthly target 9 months running.
- Handled customer escalations for the branch.

SKILLS
Communication, Negotiation, Excel, CRM

EDUCATION
B.Com, Kerala University, 2023`,
]

const JOBS = [
  {
    deptCode: 'IT',
    title: 'ASP.NET Developer',
    description: `We are looking for a backend developer to own services in our claims platform.

You will design and ship REST APIs in ASP.NET Core, work with SQL Server at scale,
and take responsibility for what you ship — including its performance in production.
The team deploys with Docker on Azure and runs its own on-call.

What the role needs:
- Strong C# and ASP.NET Core, including dependency injection and middleware
- Entity Framework Core, and an understanding of what it does to your queries
- SQL Server: indexing, execution plans, and why a query got slow
- Comfort with Docker and a CI/CD pipeline
- Someone who can explain a trade-off, not just name a technology`,
    skills_required: ['C#', 'ASP.NET Core', 'SQL Server', 'Entity Framework'],
    skills_preferred: ['Azure', 'Docker', 'React'],
    primary_skill: 'ASP.NET Core',
    primary_skill_min_years: 3,
    publish: { career_portal: true },
    experience: { min_years: 3, max_years: 7, level: 'Experienced' },
    compensation: { min_lpa: 12, max_lpa: 20, disclosed: false },
    openings: 3,
    screening_profile: { hiring_type: 'IT', match_threshold: 72 },
  },
  {
    deptCode: 'IT',
    title: 'Platform Engineer',
    description: `Platform engineering for a multi-tenant SaaS running across three regions.

You will own the Kubernetes estate and the Terraform that describes it, keep the
Kafka event bus healthy, and be the person other engineers ask when a deploy
behaves strangely. Python services, AWS underneath.

What the role needs:
- Production Kubernetes — not a course, actual incidents
- Terraform, and opinions about how to structure it
- Python for tooling and services
- Kafka or a comparable event bus
- System design judgement: knowing which complexity is worth it`,
    skills_required: ['Kubernetes', 'Terraform', 'Python', 'AWS'],
    skills_preferred: ['Kafka', 'Go', 'PostgreSQL', 'Docker'],
    experience: { min_years: 5, max_years: 10, level: 'Senior' },
    compensation: { min_lpa: 28, max_lpa: 45, disclosed: false },
    openings: 1,
    screening_profile: { hiring_type: 'IT', match_threshold: 75 },
  },
  {
    deptCode: 'SLS',
    title: 'Business Development Manager',
    description: `Own a region's channel business for our insurance products.

You will recruit and develop an agent network, carry a quarterly number, and run
the CRM discipline that makes the pipeline forecastable. This is a field role
with real travel.

What the role needs:
- Channel or agency sales in insurance or financial services
- A track record against a number you can talk through quarter by quarter
- Salesforce or comparable CRM, used properly
- Enough seniority to train and hold a team accountable`,
    skills_required: ['Agency Channel', 'Life Insurance', 'Lead Generation', 'Negotiation', 'CRM'],
    skills_preferred: ['Team Leadership', 'Excel', 'Salesforce'],
    primary_skill: 'Agency Channel',
    primary_skill_min_years: 3,
    publish: { career_portal: true, linkedin: true },
    experience: { min_years: 4, max_years: 9, level: 'Experienced' },
    compensation: { min_lpa: 10, max_lpa: 16, disclosed: true },
    openings: 2,
    screening_profile: { hiring_type: 'Sales', match_threshold: 68 },
  },
]

export function isSeeded() {
  return db.all('departments').length > 0 || db.all('candidates').length > 0
}

/**
 * Build the demo world. Runs the real engines — nothing below is a fixture that
 * bypasses the pipeline.
 */
export async function seed({ onProgress } = {}) {
  const step = (msg) => onProgress?.(msg)

  step('Creating departments…')
  const it = createDepartment({
    name: 'Information Technology',
    code: 'IT',
    location: { state: 'Maharashtra', city: 'Mumbai', area: 'Borivali' },
    zone: 'West',
    headcount: 42,
  })
  const sales = createDepartment({
    name: 'Sales',
    code: 'SLS',
    location: { state: 'Maharashtra', city: 'Pune' },
    zone: 'West',
    headcount: 120,
  })
  const byCode = { IT: it._id, SLS: sales._id }

  step('Creating jobs…')
  const jobs = JOBS.map((j) =>
    createJob({
      ...j,
      department_id: byCode[j.deptCode],
      location: { state: 'Maharashtra', city: j.deptCode === 'IT' ? 'Mumbai' : 'Pune', mode: 'Hybrid' },
      employment_type: 'Full-time',
    }),
  )
  const chennai = createJob({
    deptCode: 'SLS',
    department_id: sales._id,
    title: 'Sales Support Executive',
    description: `Support the Chennai branch sales team for our insurance broking business.

You will follow up leads, prepare quotes for motor and health policies, coordinate
with insurers on documentation, and keep the CRM up to date. Tamil and English are
both used daily with customers.

What the role needs:
- 1–3 years in insurance, banking or financial-services sales support
- Comfort speaking with customers on the phone in Tamil and English
- Basic Excel, and discipline with the CRM`,
    skills_required: ['Customer Service', 'Motor Insurance', 'Health Insurance', 'CRM', 'Excel'],
    skills_preferred: ['Inside Sales'],
    primary_skill: 'Customer Service',
    experience: { min_years: 1, max_years: 3, level: 'Experienced' },
    compensation: { min_lpa: 3, max_lpa: 4.5, disclosed: true },
    openings: 2,
    location: { state: 'Tamil Nadu', city: 'Chennai', mode: 'On-site' },
    employment_type: 'Full-time',
    interview_language_default: 'ta-IN',
    screening_profile: { hiring_type: 'Sales', match_threshold: 60 },
    publish: { career_portal: true },
  })

  step('Ingesting resumes…')
  const candidates = []
  for (const text of RESUMES) {
    const { candidate } = await ingestResume({ filename: `${text.split('\n')[0].toLowerCase().replace(/\s+/g, '_')}.txt`, text })
    candidates.push(candidate)
  }

  step('Tagging candidates to jobs…')
  // Deliberately overlapping: one candidate on two jobs, so the universal pool
  // is visibly a pool rather than a per-job list.
  const tagging = [
    [0, 0], [1, 0], [3, 0],          // .NET role
    [2, 1], [0, 1],                  // Platform role
    [4, 2], [5, 2],                  // Sales role
  ]
  const appIds = []
  for (const [ci, ji] of tagging) {
    const { application } = createApplication({
      candidate_id: candidates[ci]._id,
      job_id: jobs[ji]._id,
      source: { channel: 'resume_upload', by: 'seed' },
    })
    appIds.push(application._id)
  }

  step('Importing a Naukri profile…')
  // Shaped exactly like a Naukri Resdex card, as the Chrome extension sends it.
  const naukri = await importFromPortal({
    source: 'naukri',
    url: 'https://resdex.naukri.com/profile/demo-000123',
    text: `Karthik Subramanian
3y 4m
₹ 3.60 Lacs
Chennai
Current
Sales Coordinator at Sundaram Motors Finance Pvt. Ltd.
Previous
Customer Service Executive at Vels Insurance Services
Education
B.Com University of Madras 2020
Pref. locations
Chennai, Coimbatore
Key skills
Customer Service | Motor Insurance | Inside Sales | Excel | CRM | Tamil | Health Insurance
May also know
Renewals | Policy Docu... more
karthik.s@example.com | 9840012345`,
  }, { job_id: chennai._id })
  appIds.push(naukri.application._id)

  step('Receiving a career-page application…')
  const applied = await applyToJob({
    job_id: chennai._id,
    full_name: 'Divya Raman',
    email: 'divya.raman@example.com',
    phone: '9884455667',
    city: 'Chennai',
    total_experience_years: 2,
    consent: true,
    resume_text: `Working as Tele Sales Executive at Star Health Partners
Total experience: 2 years
Current CTC: 3 LPA | Expected CTC: 4 LPA | Notice period: 15 days
Languages: Tamil, English

Called 80+ leads a day for health insurance renewals; converted 18% against a team average of 11%.
Maintained every call in the CRM and prepared daily reports in Excel.

SKILLS
Health Insurance, Customer Service, Inside Sales, CRM, Excel, Communication`,
  })
  appIds.push(applied.application._id)

  step('Screening against the job descriptions…')
  await screenBatch(appIds, { concurrency: 5, onProgress: (d, t) => step(`Screening ${d}/${t}…`) })

  // Move the strongest match forward so the console opens on something with a
  // pipeline in it rather than a wall of "sourced".
  const topApp = db
    .find('applications', { job_id: jobs[0]._id })
    .sort((a, b) => (b.screening?.match_percent ?? 0) - (a.screening?.match_percent ?? 0))[0]
  if (topApp) moveStage(topApp._id, 'screened', 'Seed data')

  step('Done')
  return { departments: 2, jobs: jobs.length + 1, candidates: candidates.length + 2, applications: appIds.length }
}
