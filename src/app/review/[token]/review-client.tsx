'use client'

import { useState } from 'react'
import { submitReview } from '@/lib/actions/reviews'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Star } from 'lucide-react'
import { cn } from '@/lib/utils'

export function ReviewClient({ reqInfo }: { reqInfo: any }) {
    const [rating, setRating] = useState(0)
    const [hoveredRating, setHoveredRating] = useState(0)
    const [comment, setComment] = useState('')
    const [submitted, setSubmitted] = useState(false)
    const [isSubmitting, setIsSubmitting] = useState(false)

    if (reqInfo.status !== 'pending') {
        return (
            <div className="text-center py-10">
                <h2 className="text-xl font-bold mb-2">Reseña ya completada</h2>
                <p className="text-muted-foreground">Gracias por habernos dejado tu opinión anteriormente.</p>
            </div>
        )
    }

    if (submitted) {
        return (
            <div className="text-center py-10">
                <h2 className="text-xl font-bold mb-2">¡Gracias por tu opinión!</h2>
                <p className="text-muted-foreground">Valoramos mucho tu feedback para seguir mejorando.</p>
            </div>
        )
    }

    const handleSubmit = async () => {
        if (rating === 0) return
        setIsSubmitting(true)

        let category: 'high' | 'improvement' | 'low' = 'low'
        if (rating === 5) category = 'high'
        else if (rating >= 3) category = 'improvement'

        let isGoogleRedirect = false
        if (rating === 5 && reqInfo.branch?.google_review_url) {
            isGoogleRedirect = true
        }

        await submitReview(reqInfo.id, rating, category, comment || null, isGoogleRedirect)

        if (isGoogleRedirect) {
            window.location.href = reqInfo.branch.google_review_url
        } else {
            setSubmitted(true)
        }

        setIsSubmitting(false)
    }

    return (
        <div className="space-y-6">
            <div className="text-center space-y-2">
                <h1 className="text-2xl font-bold">¿Cómo fue tu experiencia?</h1>
                <p className="text-muted-foreground">
                    En {reqInfo.branch?.name || 'Monaco Smart Barber'} nos importa tu opinión.
                </p>
            </div>

            <div className="flex justify-center gap-2 py-4">
                {[1, 2, 3, 4, 5].map((star) => (
                    <button
                        key={star}
                        onClick={() => setRating(star)}
                        onMouseEnter={() => setHoveredRating(star)}
                        onMouseLeave={() => setHoveredRating(0)}
                        className="p-1 focus:outline-none transition-transform hover:scale-110"
                    >
                        <Star
                            className={cn(
                                "size-10 transition-colors",
                                (hoveredRating || rating) >= star
                                    ? "fill-amber-400 text-amber-400"
                                    : "text-muted-foreground/20 fill-transparent"
                            )}
                        />
                    </button>
                ))}
            </div>

            {rating > 0 && rating < 5 && (
                <div className="space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-300">
                    <p className="text-sm font-medium text-center">
                        ¡Oops! Sentimos no haber alcanzado las 5 estrellas. ¿Qué podríamos mejorar?
                    </p>
                    <Textarea
                        placeholder="Dejanos tu comentario privado para ayudarnos a mejorar..."
                        value={comment}
                        onChange={(e) => setComment(e.target.value)}
                        className="min-h-[100px] resize-none"
                    />
                </div>
            )}

            {rating === 5 && (
                <div className="space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-300">
                    <p className="text-sm font-medium text-center text-emerald-600">
                        ¡Excelente! Nos alegra mucho saberlo.
                    </p>
                </div>
            )}

            <Button
                className="w-full"
                size="lg"
                disabled={rating === 0 || isSubmitting}
                onClick={handleSubmit}
            >
                {isSubmitting ? 'Procesando...' : rating === 5 ? 'Continuar' : 'Enviar Feedback'}
            </Button>
        </div>
    )
}
