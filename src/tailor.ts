import { analyze } from './analyzer.js';
import { scrapeJob } from './scraper.js';
import type { Analysis } from './types.js';

/**
 * Extract structured bullet points from resume text.
 * Splits on common bullet markers and filters empty lines.
 */
export function extractBulletsFromResume(resumeText: string): string[] {
  const lines = resumeText.split('\n');
  const bullets: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    // Match common bullet markers: •, -, *, →, etc.
    const match = trimmed.match(/^[•\-\*→·∘]\s+(.+)/);
    if (match) {
      bullets.push(match[1]);
    } else if (
      trimmed.startsWith('- ') ||
      trimmed.startsWith('* ') ||
      trimmed.startsWith('• ')
    ) {
      bullets.push(trimmed.replace(/^[•\-*]\s+/, ''));
    }
  }

  return bullets.filter(b => b.length > 0);
}

/**
 * Score resume bullets for relevance to job requirements.
 * Higher score = better match.
 */
function scoreBulletRelevance(bullet: string, requirements: string[]): number {
  let score = 0;
  const bulletLower = bullet.toLowerCase();

  // Track how many requirements this bullet matches
  let matchCount = 0;

  for (const req of requirements) {
    const reqLower = req.toLowerCase();

    // Exact phrase match = highest score
    if (bulletLower.includes(reqLower)) {
      score += 10;  // Increased weight for exact match
      matchCount++;
    } else {
      // Word match (more lenient)
      const reqWords = reqLower.split(/\s+/).filter(w => w.length > 2);
      let wordMatches = 0;
      for (const word of reqWords) {
        if (bulletLower.includes(word)) {
          wordMatches++;
        }
      }

      // If we matched multiple words from the requirement, give bonus
      if (wordMatches > 1) {
        score += 3;
        matchCount++;
      } else if (wordMatches === 1) {
        score += 1;
      }
    }
  }

  // Bonus for matching multiple different requirements
  if (matchCount > 1) {
    score += matchCount * 2;
  }

  return score;
}

/**
 * Reorder resume bullets by relevance to job requirements.
 * Highly relevant bullets move to the top.
 */
export function tailorBulletOrder(
  resumeText: string,
  jobRequirements: string[],
): string {
  const bullets = extractBulletsFromResume(resumeText);

  if (bullets.length === 0) {
    return resumeText;
  }

  // Score each bullet
  const scored = bullets.map(bullet => ({
    bullet,
    score: scoreBulletRelevance(bullet, jobRequirements),
  }));

  // Sort by score (highest first), then by original order for ties
  scored.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return bullets.indexOf(a.bullet) - bullets.indexOf(b.bullet);
  });

  // Reconstruct resume with reordered bullets
  // Split by common section headers to preserve structure
  const lines = resumeText.split('\n');
  const result: string[] = [];
  let currentBulletList: string[] = [];
  let inBulletSection = false;

  for (const line of lines) {
    const trimmed = line.trim();
    const isBullet = /^[•\-\*→·∘]\s+/.test(trimmed) ||
                     trimmed.match(/^\d+\.\s+/); // numbered list

    if (isBullet) {
      inBulletSection = true;
      // Extract the bullet content
      const match = trimmed.match(/^[•\-\*→·∘·]\s+(.+)/) ||
                    trimmed.match(/^\d+\.\s+(.+)/);
      if (match) {
        currentBulletList.push(match[1]);
      }
    } else if (inBulletSection && trimmed.length === 0) {
      // End of bullet section - output reordered bullets
      const indentMatch = lines.find(l => /^[•\-\*→·∘·]\s+/.test(l.trim()))?.match(/^(\s*)/);
      const indent = indentMatch ? indentMatch[1] : '';

      for (const bullet of scored) {
        if (currentBulletList.includes(bullet.bullet)) {
          result.push(`${indent}• ${bullet.bullet}`);
        }
      }

      result.push('');
      currentBulletList = [];
      inBulletSection = false;
    } else {
      // Non-bullet line (header, etc.)
      if (inBulletSection && currentBulletList.length > 0) {
        // Flush current bullets before outputting non-bullet
        const indentMatch = lines.find(l => /^[•\-\*→·∘·]\s+/.test(l.trim()))?.match(/^(\s*)/);
        const indent = indentMatch ? indentMatch[1] : '';

        for (const bullet of scored) {
          if (currentBulletList.includes(bullet.bullet)) {
            result.push(`${indent}• ${bullet.bullet}`);
          }
        }

        currentBulletList = [];
        inBulletSection = false;
      }
      result.push(line);
    }
  }

  // Flush any remaining bullets
  if (inBulletSection && currentBulletList.length > 0) {
    const indent = '  ';
    for (const bullet of scored) {
      if (currentBulletList.includes(bullet.bullet)) {
        result.push(`${indent}• ${bullet.bullet}`);
      }
    }
  }

  return result.join('\n');
}

/**
 * Tailor a resume to a specific job by:
 * 1. Analyzing the job to extract requirements
 * 2. Reordering resume bullets by relevance
 * 3. Returning the tailored resume
 */
export async function tailorResumeToJob(
  baseResume: string,
  jobUrl: string,
  jobDescriptionText?: string,
): Promise<{
  tailoredResume: string;
  analysis: Analysis;
  bulletsIncluded: number;
}> {
  // Fetch job description if not provided
  let jobDescription = jobDescriptionText;
  if (!jobDescription) {
    jobDescription = await scrapeJob(jobUrl);
  }

  if (!jobDescription || jobDescription.length === 0) {
    throw new Error('Could not fetch or parse job description');
  }

  // Analyze job to extract requirements
  const analysis = await analyze(jobDescription, baseResume, jobUrl, false);

  // Reorder resume bullets by relevance to requirements
  const tailoredResume = tailorBulletOrder(baseResume, analysis.requirements);

  // Count bullets in tailored resume
  const bullets = extractBulletsFromResume(tailoredResume);

  return {
    tailoredResume,
    analysis,
    bulletsIncluded: bullets.length,
  };
}
