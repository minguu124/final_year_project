import {
  uploadToCloudinary,
  deleteFromCloudinary,
} from '../../utils/cloudinary'
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

const Query = {
  /**
   * Gets all posts
   *
   * @param {string} authUserId
   * @param {int} skip how many posts to skip
   * @param {int} limit how many posts to limit
   */
  getPosts: async (root, { authUserId, skip, limit }, { Post }) => {
    const query = {
      AND: [
        {
          image: {
            not: null,
          },
        },
        {
          authorId: {
            not: parseInt(authUserId),
          },
        },
      ],
    }
    const postsCount = await prisma.post.count({
      where: query,
    })
    const allPosts = await prisma.post.findMany({
      where: query,
      include: {
        author: {
          include: {
            followers: true,
            following: true,
            notifications: {
              include: {
                author: true,
                follow: true,
                like: true,
                comment: true,
              },
            },
          },
        },
        likes: {
          include: {
            user: true,
            post: true,
          }
        },
        comments: {
          include: {
            author: true,
          },
          orderBy: {
            createdAt: 'desc',
          },
        },
      },
      skip: skip,
      first: limit,
      orderBy: {
        createdAt: 'desc',
      },
    })

    return { posts: allPosts, count: postsCount }
  },
  /**
   * Gets posts from followed users
   *
   * @param {string} userId
   * @param {int} skip how many posts to skip
   * @param {int} limit how many posts to limit
   */
  getFollowedPosts: async (root, { userId, skip, limit }, { Post, Follow }) => {
    // Find user ids, that current user follows
    let userFollowing = []
    const follow = await prisma.follow.findMany({
      where: {
        followerId: parseInt(userId),
      },
      select: {
        userId: true,
      },
    })
    follow.map((f) => userFollowing.push(f.userId))

    const query = {
      OR: [{ authorId: { in: userFollowing } }, { authorId: parseInt(userId) }],
    }

    const followedPostsCount = prisma.post.count({where:query})
    const followedPosts = prisma.post.findMany({
      where: query,
      include: {
        author: {
          include: {
            followers: true,
            following: true,
            notifications: {
              include: {
                author: true,
                follow: true,
                like: true,
                comment: true,
              },
            },
          },
        },
        likes: {
          select: {
            id: true,
            userId: true,
            postId: true
          },
        },
        comments: {
          include: {
            author: true,
          },
          orderBy: {
            createdAt: 'desc'
          }
        },
      },
      skip: skip,
      first: limit,
      orderBy: {
        createdAt: 'desc'
      }
    })

    return { posts: followedPosts, count: followedPostsCount }
  },
  /**
   * Gets post by id
   *
   * @param {string} id
   */
  getPost: async (root, { id }, { Post }) => {
    const post = await prisma.post.findOne({
      where: {
        id: parseInt(id),
      },
      include: {
        author: {
          include: {
            followers: true,
            following: true,
            notifications: {
              include: {
                author: true,
                follow: true,
                like: true,
                comment: true,
              },
            },
          },
        },
        likes: true,
        comments: {
          include: {
            author: true,
          },
          orderBy: {
            createdAt: 'asc',
          },
        },
      },
    })
    return post
  },
}

const Mutation = {
  /**
   * Creates a new post
   *
   * @param {string} title
   * @param {string} image
   * @param {string} authorId
   */
  createPost: async (
    root,
    { input: { title, image, authorId } },
    { Post, User },
  ) => {
    if (!title && !image) {
      throw new Error('Post title or image is required.')
    }

    let imageUrl, imagePublicId
    if (image) {
      const { createReadStream } = await image
      const stream = createReadStream()
      const uploadImage = await uploadToCloudinary(stream, 'post')

      if (!uploadImage.secure_url) {
        throw new Error(
          'Something went wrong while uploading image to Cloudinary',
        )
      }

      imageUrl = uploadImage.secure_url
      imagePublicId = uploadImage.public_id
    }

    const newPost = await prisma.post.create({
      data: {
        title: title,
        image: imageUrl,
        imagePublicId: imagePublicId,
        author: {
          connect: {
            id: parseInt(authorId),
          },
        },
      },
    })

    return newPost
  },
  /**
   * Deletes a user post
   *
   * @param {string} id
   * @param {imagePublicId} id
   */
  deletePost: async (
    root,
    { input: { id, imagePublicId } },
    { Post, Like, User, Comment, Notification },
  ) => {
    // Remove post image from cloudinary, if imagePublicId is present
    if (imagePublicId) {
      const deleteImage = await deleteFromCloudinary(imagePublicId)

      if (deleteImage.result !== 'ok') {
        throw new Error(
          'Something went wrong while deleting image from Cloudinary',
        )
      }
    }
    // Find posts comments authors
    const postCommentsAuthors = await prisma.comment.findMany({
      where: {
        postId: id,
      },
      select: {
        id: true,
        authorId: true,
      },
    })

    //Disconnect authors with posts comments
    postCommentsAuthors.map(async (f) => {
      await prisma.user.update({
        where: {
          id: f.authorId,
        },
        data: {
          comments: {
            disconnect: [{ id: f.id }],
          },
        },
      })
    })

    // Find posts likes authors
    const postLikesAuthors = await prisma.like.findMany({
      where: {
        postId: id,
      },
      select: {
        id: true,
        author: true,
      },
    })

    //Disconnect authors with posts comments
    postLikesAuthors.map(async (f) => {
      await prisma.user.update({
        where: {
          id: f.authorId,
        },
        data: {
          likes: {
            disconnect: [{ id: f.id }],
          },
        },
      })
    })

    //Delete all post likes and comments
    const post = await prisma.post.update({
      where: {
        id: id,
      },
      data: {
        likes: {
          delete: true,
        },
        comments: {
          delete: true,
        },
      },
    })

    const userNotifications = await prisma.notification.findMany({
      where: {
        postId: id,
      },
      select: {
        id: true,
      },
    })

    //Delete user post and notifications
    await prisma.user.update({
      where: {
        id: post.authorId,
      },
      data: {
        posts: {
          delete: [{ id: id }],
        },
        notifications: userNotifications,
      },
    })

    return post
  },
}

export default { Query, Mutation }
