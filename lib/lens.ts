const normSearchTerm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export function keywordForNewSearch(keywords: string[] | undefined, area: string): string {
  const areaKey = normSearchTerm(area);
  return (keywords ?? [])
    .filter((kw) => {
      const key = normSearchTerm(kw);
      return key && (!areaKey || (key !== areaKey && !areaKey.includes(key) && !key.includes(areaKey)));
    })
    .join(" ");
}
