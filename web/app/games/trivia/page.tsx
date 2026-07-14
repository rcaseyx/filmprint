"use client"

import { useState, useEffect } from "react"
import Image from "next/image"
import Link from "next/link"
import { useSession } from "next-auth/react"
import { authHeader } from "@/lib/api"

const API = process.env.NEXT_PUBLIC_API_URL
const TMDB_IMG = "https://image.tmdb.org/t/p/w185"

interface Question {
  id: number
  source: string
  question_type: string
  question_text: string
  options: string[]
  image_url: string | null
  movie_title: string | null
}

interface AnswerResult {
  correct: boolean
  correct_answer: string
}

export default function TriviaPage() {
  const { data: session, status } = useSession()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [questions, setQuestions] = useState<Question[]>([])
  const [index, setIndex] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  const [result, setResult] = useState<AnswerResult | null>(null)
  const [checking, setChecking] = useState(false)
  const [score, setScore] = useState(0)

  async function loadSession() {
    setLoading(true)
    setError(false)
    setIndex(0)
    setSelected(null)
    setResult(null)
    setScore(0)
    try {
      const res = await fetch(`${API}/api/games/trivia/session`, { headers: authHeader(session) })
      if (!res.ok) { setError(true); return }
      const data = await res.json()
      setQuestions(data.questions)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (status !== "authenticated") return
    loadSession()
  }, [status, session])

  async function selectAnswer(answer: string) {
    if (result || checking) return
    setSelected(answer)
    setChecking(true)
    try {
      const res = await fetch(`${API}/api/games/trivia/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader(session) },
        body: JSON.stringify({ question_id: questions[index].id, answer }),
      })
      if (res.ok) {
        const data: AnswerResult = await res.json()
        setResult(data)
        if (data.correct) setScore((s) => s + 1)
      }
    } finally {
      setChecking(false)
    }
  }

  function next() {
    setSelected(null)
    setResult(null)
    setIndex((i) => i + 1)
  }

  if (loading || status === "loading") {
    return <div className="max-w-2xl mx-auto px-6 py-12 text-neutral-500">Loading...</div>
  }

  if (error || questions.length === 0) {
    return (
      <div className="max-w-2xl mx-auto px-6 py-12">
        <BackLink />
        <p className="text-neutral-500 mt-6">Couldn&rsquo;t load trivia — try refreshing.</p>
      </div>
    )
  }

  const done = index >= questions.length

  if (done) {
    return (
      <div className="max-w-2xl mx-auto px-6 py-12 text-center">
        <BackLink />
        <div className="mt-8">
          <h1 className="text-xl font-semibold text-neutral-100">Session complete!</h1>
          <p className="text-4xl font-extrabold text-neutral-100 mt-4">
            {score} / {questions.length}
          </p>
          <button
            onClick={loadSession}
            className="mt-6 rounded-xl bg-brand text-neutral-950 font-semibold py-3 px-8 hover:opacity-90 transition-opacity"
          >
            Play again
          </button>
        </div>
      </div>
    )
  }

  const q = questions[index]

  return (
    <div className="max-w-2xl mx-auto px-6 py-12">
      <div className="flex items-center justify-between">
        <BackLink />
        <span className="text-sm text-neutral-500">
          {index + 1} / {questions.length}
        </span>
      </div>

      <h1 className="text-xl font-semibold text-neutral-100 mt-6">Trivia</h1>

      {q.image_url && (
        <div className="flex justify-center mt-6">
          <Image
            src={`${TMDB_IMG}${q.image_url}`}
            alt="Mystery actor"
            width={120}
            height={180}
            className="rounded-xl object-cover bg-neutral-800"
          />
        </div>
      )}

      {q.movie_title && (
        <p className="text-sm font-medium text-brand mt-6">{q.movie_title}</p>
      )}

      <p className={`text-lg text-neutral-100 ${q.movie_title ? "mt-1" : "mt-6"}`}>{q.question_text}</p>

      <div className="grid grid-cols-1 gap-3 mt-6">
        {q.options.map((opt) => {
          const isSelected = selected === opt
          const isCorrect = result && opt === result.correct_answer
          const isWrong = result && isSelected && !result.correct
          return (
            <button
              key={opt}
              onClick={() => selectAnswer(opt)}
              disabled={!!result || checking}
              className={`text-left rounded-xl border px-4 py-3 transition-colors disabled:cursor-default ${
                isCorrect
                  ? "border-green-500 bg-green-500/10 text-neutral-100"
                  : isWrong
                  ? "border-red-500 bg-red-500/10 text-neutral-100"
                  : isSelected
                  ? "border-brand text-neutral-100"
                  : "border-neutral-800 bg-neutral-900 text-neutral-200 hover:border-neutral-700"
              }`}
            >
              {opt}
            </button>
          )
        })}
      </div>

      {result && (
        <button
          onClick={next}
          className="mt-6 w-full rounded-xl bg-brand text-neutral-950 font-semibold py-3 hover:opacity-90 transition-opacity"
        >
          {index + 1 < questions.length ? "Next" : "See results"}
        </button>
      )}
    </div>
  )
}

function BackLink() {
  return (
    <Link href="/games" className="text-sm text-neutral-500 hover:text-neutral-300 transition-colors">
      &larr; Games
    </Link>
  )
}
