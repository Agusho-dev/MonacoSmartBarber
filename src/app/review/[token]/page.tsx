import { getReviewRequestInfo } from '@/lib/actions/reviews'
import { notFound } from 'next/navigation'
import { ReviewClient } from './review-client'

export default async function ReviewPage({ params }: { params: { token: string } }) {
    const reqInfo = await getReviewRequestInfo(params.token)

    if (!reqInfo) {
        notFound()
    }

    return (
        <div className="flex min-h-screen bg-muted/30 pb-20 pt-10 px-4 sm:px-0">
            <div className="mx-auto w-full max-w-md bg-white rounded-2xl shadow-sm border p-6">
                <ReviewClient reqInfo={reqInfo} />
            </div>
        </div>
    )
}
